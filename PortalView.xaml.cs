using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;

namespace KalugaCampus;

public partial class PortalView : UserControl
{
    internal const string Site = "https://e-learning.bmstu.ru/kaluga/";
    private const string SignInPage = Site + "my/";
    private const string RequestPlaceholder = "/* CAMPUS_REQUEST */ null";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Lazy<string> SessionScript = new(() =>
    {
        string Read(string name)
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("KalugaCampus.Ui." + name)
                ?? throw new InvalidOperationException("Отсутствует модуль чтения ЭОС.");
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd();
        }
        return Read("session.js").Replace("/* CAMPUS_LAB_SESSION */", Read("lab-session.js"));
    });

    private readonly CoreWebView2Environment environment;
    private readonly Action<bool> showPortal;
    private Task? initialization;
    private TaskCompletionSource<StudyData?>? signIn;
    private bool disposing;
    private bool darkTheme;
    internal void SetTheme(bool dark)
    {
        darkTheme = dark;
        PortalBar.Background = dark ? System.Windows.Media.Brushes.Black : MainWindow.NormalCaption;
        Browser.DefaultBackgroundColor = dark ? System.Drawing.Color.Black : System.Drawing.Color.White;
        if (Browser.CoreWebView2 is { } web)
            web.Profile.PreferredColorScheme = dark ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;
    }
    private readonly bool lksMode;
    internal string AccountId { get; init; } = Accounts.DefaultId;
    private TaskCompletionSource<StudyData?>? syncingSignIn;

    internal PortalView(CoreWebView2Environment environment, Action<bool> showPortal, bool lksMode = false)
    {
        this.environment = environment;
        this.lksMode = lksMode;
        this.showPortal = showPortal;
        InitializeComponent();
    }

    internal async Task<StudyData?> SignInAsync()
    {
        if (signIn is not null)
            return await signIn.Task;

        var result = new TaskCompletionSource<StudyData?>(TaskCreationOptions.RunContinuationsAsynchronously);
        signIn = result;
        AddressLabel.Text = "Открываем официальный вход МГТУ…";
        try
        {
            BeginLogin();
            await EnsureBrowserAsync();
            if (signIn == result)
                Browser.CoreWebView2.Navigate(SignInPage);
            return await result.Task;
        }
        catch
        {
            if (signIn == result)
                FinishSignIn();
            throw;
        }
    }

    internal async Task ShowPageAsync(string url)
    {
        if (!IsEosPage(url))
            throw new MoodleException("Ссылка должна вести на ЭОС Калужского филиала.");
        if (signIn is not null)
            throw new MoodleException("Сначала завершите вход в ЭОС.");
        automaticLoginAvailable = true;
        showPortal(true);
        await EnsureBrowserAsync();
        Browser.CoreWebView2.Navigate(url);
    }

    internal Task<StudyData> GetDashboardAsync() => ReadSessionAsync<StudyData>(new { action = "dashboard" });

    internal Task<CourseSection[]> GetCourseAsync(long courseId) =>
        ReadSessionAsync<CourseSection[]>(new { action = "course", courseId });

    internal Task<string> GetSubmissionAsync(string url) =>
        ReadSessionAsync<string>(new { action = "submission", url });

    internal Task<JsonElement> GetLabAsync(long assignmentId) =>
        ReadSessionAsync<JsonElement>(new { action = "labDetails", assignmentId });

    internal Task<JsonElement> GetWorkIndexAsync(long courseId) =>
        ReadSessionAsync<JsonElement>(new { action = "workIndex", courseId });

    internal Task<JsonElement> GetActivityInfoAsync(string url) =>
        ReadSessionAsync<JsonElement>(new { action = "activityInfo", url });

    internal Task<JsonElement> GetLabEditorAsync(long assignmentId) =>
        ReadSessionAsync<JsonElement>(new { action = "labEditor", assignmentId });

    internal async Task<JsonElement> SaveLabAsync(
        long assignmentId, string[] paths, bool replace, bool statement, string statementText)
    {
        await ReadSessionAsync<bool>(new { action = "prepareLabUpload" });
        var web = Browser.CoreWebView2;
        try
        {
            using var document = JsonDocument.Parse(await web.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
            var root = document.RootElement.Get("root").Number("nodeId");
            var query = JsonSerializer.Serialize(new { nodeId = root, selector = "#campus-local-lab-files" }, Json);
            using var field = JsonDocument.Parse(await web.CallDevToolsProtocolMethodAsync("DOM.querySelector", query));
            var nodeId = field.RootElement.Number("nodeId");
            if (nodeId <= 0 || !IsEosPage(web.Source))
                throw new MoodleException("Окно ЭОС изменилось во время подготовки загрузки.");

            var files = JsonSerializer.Serialize(new { nodeId, files = paths }, Json);
            await web.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", files);
            return await ReadSessionAsync<JsonElement>(new { action = "labSave", assignmentId, replace, statement, statementText },
                TimeSpan.FromMinutes(16));
        }
        finally
        {
            if (!disposing && IsEosPage(web.Source))
                _ = web.ExecuteScriptAsync("document.getElementById('campus-local-lab-files')?.remove()");
        }
    }

    internal void EndSession()
    {
        EndLoading();
        disposing = true;
        lksRequest?.TrySetCanceled();
        signIn?.TrySetResult(null);
        signIn = null;
        Browser.Dispose();
    }

    internal static bool IsEosPage(string url) => OfficialUri(url) is { Host: "e-learning.bmstu.ru" } uri &&
        uri.AbsolutePath.StartsWith("/kaluga/", StringComparison.Ordinal);

    private static Uri? OfficialUri(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps &&
        uri.IsDefaultPort && uri.UserInfo.Length == 0 ? uri : null;

    private bool IsAllowed(string url) =>
        url == "about:blank" || OfficialUri(url) is { Host: "sso.bmstu.ru" } ||
        (lksMode ? OfficialUri(url) is { Host: "lks.bmstu.ru" } : IsEosPage(url));

    private async Task EnsureBrowserAsync()
    {
        initialization ??= InitializeBrowserAsync();
        try
        {
            await initialization;
        }
        catch
        {
            initialization = null;
            throw;
        }
    }

    private async Task InitializeBrowserAsync()
    {
        var options = environment.CreateCoreWebView2ControllerOptions();
        options.ProfileName = lksMode ? "LksSession" : "EosSession";
        if (AccountId != Accounts.DefaultId) options.ProfileName += "_" + AccountId;
        options.IsInPrivateModeEnabled = false;
        await Browser.EnsureCoreWebView2Async(environment, options);
        if (disposing)
            return;
        var web = Browser.CoreWebView2;
        web.Settings.AreHostObjectsAllowed = false;
        SetTheme(darkTheme);
        web.Settings.IsWebMessageEnabled = false;
        web.Settings.AreDevToolsEnabled = false;
        web.Settings.IsPasswordAutosaveEnabled = false;
        web.Settings.IsGeneralAutofillEnabled = false;
        web.Settings.AreDefaultContextMenusEnabled = false;
        web.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        web.NavigationStarting += (_, args) =>
        {
            navigationId = args.NavigationId;
            args.Cancel = !IsAllowed(args.Uri);
            if (args.Cancel)
                AddressLabel.Text = lksMode ? "Ссылка ведёт за пределы ЛКС и SSO МГТУ." : "Ссылка ведёт за пределы ЭОС и SSO МГТУ.";
        };
        web.SourceChanged += (_, _) =>
        {
            if (syncingSignIn is null)
                AddressLabel.Text = OfficialUri(web.Source)?.Host switch
                {
                    "lks.bmstu.ru" => "Успеваемость · lks.bmstu.ru",
                    "sso.bmstu.ru" => "Официальный вход МГТУ · sso.bmstu.ru",
                    "e-learning.bmstu.ru" => "ЭОС Калужского филиала · e-learning.bmstu.ru",
                    _ => "ЭОС МГТУ"
                };
        };
        web.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (IsAllowed(args.Uri) && args.Uri != "about:blank")
                web.Navigate(args.Uri);
        };
        if (lksMode)
        {
            web.WebResourceResponseReceived += OnLksResponse;
            LksButton.Visibility = Visibility.Visible;
        }
        web.DOMContentLoaded += async (_, _) => { if (!disposing) await TryAutomaticLoginAsync(); };
        web.NavigationCompleted += OnNavigationCompleted;
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (disposing)
            return;
        if (lksMode && !e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            lksRequest?.TrySetException(new MoodleException("Не удалось открыть ЛКС. Проверьте соединение и повторите."));
        if (!e.IsSuccess)
        {
            if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            {
                AddressLabel.Text = "Страница недоступна. Нажмите «Обновить страницу» для повтора.";
                RevealLogin();
            }
            return;
        }
        try { await RevealChallengeAsync(); }
        catch (Exception) { if (!disposing) RevealLogin(); }
        if (disposing) return;
        await TryAutomaticLoginAsync();
        if (disposing) return;
        if (lksMode && lksRequest is not null && lksPage != ProfilePage &&
            OfficialUri(Browser.CoreWebView2.Source) is { Host: "lks.bmstu.ru" } landing &&
            landing.AbsolutePath.TrimEnd('/') == "/profile")
        {
            Browser.CoreWebView2.Navigate(lksPage);
            return;
        }
        var result = signIn;
        if (result is null || syncingSignIn == result || !IsEosPage(Browser.CoreWebView2.Source))
            return;
        var path = new Uri(Browser.CoreWebView2.Source).AbsolutePath;
        if (path.StartsWith("/kaluga/login/") || path.StartsWith("/kaluga/auth/") || path.StartsWith("/kaluga/admin/"))
            return;
        syncingSignIn = result;
        AddressLabel.Text = "Загружаем курсы, задания и оценки…";
        try
        {
            var signedIn = await Browser.CoreWebView2.ExecuteScriptAsync(
                "Number(window.M?.cfg?.userId ?? window.M?.cfg?.userid) > 0 && !document.body?.classList.contains('notloggedin')");
            if (signedIn != "true" || signIn != result)
            {
                AddressLabel.Text = "Войдите через МГТУ для загрузки курсов.";
                return;
            }
            var data = await GetDashboardAsync();
            if (signIn == result)
            {
                FinishSignIn();
                result.TrySetResult(data);
            }
        }
        catch (Exception ex)
        {
            if (signIn == result)
            {
                FinishSignIn();
                result.TrySetException(ex);
            }
        }
        finally
        {
            if (syncingSignIn == result)
                syncingSignIn = null;
        }
    }

    private async Task<T> ReadSessionAsync<T>(object request, TimeSpan? timeout = null)
    {
        var web = Browser.CoreWebView2;
        if (disposing || web is null || !IsEosPage(web.Source))
            throw new MoodleException("Сессия ЭОС недоступна. Войдите через МГТУ.");

        var expression = SessionScript.Value.Replace(RequestPlaceholder, JsonSerializer.Serialize(request, Json));
        var parameters = JsonSerializer.Serialize(new { expression, awaitPromise = true, returnByValue = true }, Json);
        var result = await web.CallDevToolsProtocolMethodAsync("Runtime.evaluate", parameters)
            .WaitAsync(timeout ?? TimeSpan.FromSeconds(48));
        using var response = JsonDocument.Parse(result);
        var value = response.RootElement.Get("result").Get("value");
        if (value.Get("value").ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            return value.Get("value").Deserialize<T>(Json) ?? throw new MoodleException("ЭОС вернула неполный ответ.");
        var message = value.Text("message");
        throw new MoodleException(message.Length > 0 ? message : value.Text("error") switch
        {
            "login" => "Сессия ЭОС недоступна. Войдите через МГТУ.",
            "courses" => "Вход выполнен, но ЭОС не отдала список курсов. Попробуйте войти ещё раз.",
            _ => "Не удалось загрузить данные из открытой сессии ЭОС."
        });
    }

    private void FinishSignIn()
    {
        EndLoading();
        automaticLoginAvailable = false;
        signIn = null;
        syncingSignIn = null;
        showPortal(false);
    }

    private void ReturnToCampus()
    {
        automaticLoginAvailable = false;
        if (lksMode)
        {
            lksRequest?.TrySetCanceled();
            showPortal(false);
            return;
        }
        var pending = signIn;
        FinishSignIn();
        if (pending is not null)
        {
            Browser.CoreWebView2?.Navigate("about:blank");
            pending.TrySetResult(null);
        }
    }

    private void OnReturn(object sender, RoutedEventArgs e) => ReturnToCampus();

    private void OnReload(object sender, RoutedEventArgs e) => Browser.CoreWebView2?.Reload();

}
