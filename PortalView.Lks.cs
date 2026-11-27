using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace KalugaCampus;

public partial class PortalView
{
    private const string ProgressPage = "https://lks.bmstu.ru/progress";
    private const string SessionsPage = "https://lks.bmstu.ru/session";
    private const string ProfilePage = "https://lks.bmstu.ru/profile";
    private readonly SemaphoreSlim lksReader = new(1, 1);
    private string lksPage = ProgressPage;
    private TaskCompletionSource<JsonElement>? lksRequest;
    private string LksLogin => "https://lks.bmstu.ru/portal4/cookie/login?back=" +
        Uri.EscapeDataString(lksPage) + "&profile_any=true";
    internal bool LksAuthenticated { get; set; }
    private bool loginOpened;

    internal Task<JsonElement> LoadProgressAsync() => LoadLksDataAsync(ProgressPage);
    internal Task<JsonElement> LoadSessionsAsync() => LoadLksDataAsync(SessionsPage);
    internal Task<JsonElement> ConnectLksAsync() => LoadLksDataAsync(ProfilePage);

    private async Task<JsonElement> LoadLksDataAsync(string target)
    {
        await lksReader.WaitAsync();
        lksPage = target;
        LksButton.Content = target == SessionsPage ? "К сессии" : target == ProfilePage ? "К профилю ЛКС" : "К успеваемости";
        var request = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        lksRequest = request;
        try
        {
            if (disposing) throw new OperationCanceledException();
            BeginLogin();
            await EnsureBrowserAsync();
            if (disposing || request.Task.IsCompleted) throw new OperationCanceledException();
            loginOpened = !LksAuthenticated;
            Browser.CoreWebView2.Navigate(loginOpened ? LksLogin : lksPage);
            return await request.Task.WaitAsync(TimeSpan.FromMinutes(10));
        }
        catch (TimeoutException)
        {
            LksAuthenticated = false;
            throw new MoodleException("ЛКС не передал данные вовремя. Повторите загрузку.");
        }
        catch (OperationCanceledException)
        {
            throw new MoodleException("Загрузка данных ЛКС прервана.");
        }
        finally
        {
            EndLoading();
            automaticLoginAvailable = false;
            lksRequest = null;
            lksReader.Release();
            if (!disposing) showPortal(false);
        }
    }

    private async void OnLksResponse(object? sender, CoreWebView2WebResourceResponseReceivedEventArgs args)
    {
        var request = lksRequest;
        if (request is null || disposing || OfficialUri(args.Request.Uri) is not { Host: "lks.bmstu.ru" } uri)
            return;
        bool sessions = lksPage == SessionsPage;
        bool person = uri.AbsolutePath.TrimEnd('/') == "/lks-back/api/v1/person";
        bool expected = lksPage == ProfilePage ? person : Regex.IsMatch(uri.AbsolutePath, @"^/lks-back/api/v1/student/[^/]+/" + (sessions ? "sessions" : "progress") + "/?$");
        if ((person || expected) && args.Response.StatusCode is 401 or 403)
        {
            LksAuthenticated = false;
            if (!loginOpened)
            {
                loginOpened = true;
                Browser.CoreWebView2.Navigate(LksLogin);
            }
            else if (OfficialUri(Browser.CoreWebView2.Source)?.AbsolutePath.TrimEnd('/') == new Uri(lksPage).AbsolutePath)
                request.TrySetException(new MoodleException("ЛКС не предоставил доступ. Попробуйте войти ещё раз."));
            return;
        }
        if (!expected) return;
        try
        {
            if (args.Response.StatusCode != 200)
                throw new MoodleException("ЛКС временно не смог загрузить данные.");
            if (person)
            {
                if (!args.Response.Headers.Contains("Content-Type") ||
                    !args.Response.Headers.GetHeader("Content-Type").Contains("application/json", StringComparison.OrdinalIgnoreCase))
                    throw new MoodleException("ЛКС не подтвердил вход в профиль.");
                LksAuthenticated = true;
                request.TrySetResult(JsonSerializer.SerializeToElement(true));
                return;
            }
            using var stream = await args.Response.GetContentAsync();
            using var buffer = new System.IO.MemoryStream();
            await stream.CopyToAsync(buffer);
            buffer.Position = 0;
            using var payload = JsonDocument.Parse(buffer);
            var data = payload.RootElement.Get("data");
            if (lksRequest != request || request.Task.IsCompleted) return;
            if (sessions)
            {
                if (data.ValueKind == JsonValueKind.Null || data.ValueKind == JsonValueKind.Object && !data.EnumerateObject().Any())
                    data = JsonSerializer.SerializeToElement(Array.Empty<object>());
                if (data.ValueKind != JsonValueKind.Array) throw new MoodleException("Изменился формат результатов сессии.");
                request.TrySetResult(JsonSerializer.SerializeToElement(new { terms = data, date = payload.RootElement.Text("date") }));
                LksAuthenticated = true;
                return;
            }
            var disciplines = data.Get("student").Get("disciplines");
            if (data.ValueKind is JsonValueKind.Null || data.ValueKind == JsonValueKind.Object && !data.EnumerateObject().Any())
                disciplines = JsonSerializer.SerializeToElement(Array.Empty<object>());
            if (disciplines.ValueKind != JsonValueKind.Array)
                throw new MoodleException("Формат ведомости ЛКС изменился. Откройте страницу ЛКС внутри приложения.");
            request.TrySetResult(JsonSerializer.SerializeToElement(new { disciplines, date = payload.RootElement.Text("date") }));
            LksAuthenticated = true;
        }
        catch (Exception error)
        {
            request.TrySetException(error is MoodleException ? error : new MoodleException("Не удалось прочитать ответ ЛКС."));
        }
    }

    internal async Task ShowProgressPageAsync()
    {
        automaticLoginAvailable = true;
        LksButton.Content = "К успеваемости";
        showPortal(true);
        await EnsureBrowserAsync();
        Browser.CoreWebView2.Navigate(ProgressPage);
    }
    internal async Task ClearSessionAsync()
    {
        await EnsureBrowserAsync();
        await Browser.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.AllSite);
    }
    private void OnLksProgress(object sender, RoutedEventArgs e) => Browser.CoreWebView2?.Navigate(lksRequest == null ? ProgressPage : lksPage);
}
