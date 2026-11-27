using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace KalugaCampus;

public partial class MainWindow : Window
{
    private const string DashboardPage = "https://campus-ui.invalid/index.html";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private CoreWebView2Environment? webEnvironment;
    private PortalView? portal;
    private PortalView? viewer;
    private PortalView? lks;
    private readonly Accounts accounts = new();
    private int activeRequests;
    private bool changingAccount;
    private void MinimizeWindow(object sender, RoutedEventArgs e) => SystemCommands.MinimizeWindow(this);
    private void CloseWindow(object sender, RoutedEventArgs e) => Close();
    private void MaximizeWindow(object sender, RoutedEventArgs e)
    {
        if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
        else SystemCommands.MaximizeWindow(this);
    }
    protected override void OnStateChanged(EventArgs e)
    {
        base.OnStateChanged(e);
        if (MaxButton is null) return;
        var maximized = WindowState == WindowState.Maximized;
        MaxButton.Content = maximized ? "\uE923" : "\uE922";
        MaxButton.ToolTip = maximized ? "Восстановить" : "Развернуть";
        System.Windows.Automation.AutomationProperties.SetName(MaxButton, (string)MaxButton.ToolTip);
        WindowFrame.Margin = maximized ? new Thickness(SystemParameters.WindowResizeBorderThickness.Left + 4) : new Thickness(0);
    }
    private bool sessionConnected;
    private readonly Dictionary<string, LabLocalFile> labFiles = [];
    private long activeLabEditor;
    private bool labSaving;
    private string? token;
    private bool closed;
    private bool darkTheme;

    private bool SetTheme(bool dark)
    {
        darkTheme = dark;
        CaptionBar.Background = dark ? System.Windows.Media.Brushes.Black : NormalCaption;
        portal?.SetTheme(dark);
        lks?.SetTheme(dark);
        viewer?.SetTheme(dark);
        return true;
    }

    public MainWindow() => InitializeComponent();
    internal static readonly System.Windows.Media.Brush NormalCaption =
        new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(20, 38, 73));

    private void RetryDashboard(object sender, RoutedEventArgs e)
    {
        RetryStartup.Visibility = Visibility.Collapsed;
        LoadingMessage.Text = "Открываем учебный кабинет…";
        if (Dashboard.CoreWebView2 is { } web) web.Navigate(DashboardPage);
        else OnLoaded(this, e);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var dataPath = Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "KalugaCampus", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataPath);
            if (closed)
                return;
            webEnvironment = environment;
            await Dashboard.EnsureCoreWebView2Async(environment);
            if (closed)
                return;
            var web = Dashboard.CoreWebView2;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.IsStatusBarEnabled = false;
            var html = Encoding.UTF8.GetBytes(BuildPage());
            web.AddWebResourceRequestedFilter(DashboardPage, CoreWebView2WebResourceContext.Document,
                CoreWebView2WebResourceRequestSourceKinds.Document);
            web.WebResourceRequested += (_, args) =>
            {
                if (args.Request.Uri == DashboardPage)
                {
                    args.Response = environment.CreateWebResourceResponse(
                        new MemoryStream(html, writable: false), 200, "OK", "Content-Type: text/html; charset=utf-8");
                }
            };
            web.NavigationStarting += (_, args) => args.Cancel = args.Uri != DashboardPage;
            web.NewWindowRequested += (_, args) => args.Handled = true;
            web.WebMessageReceived += OnMessage;
            web.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess)
                {
                    RetryStartup.Visibility = Visibility.Collapsed;
                    LoadingMessage.Visibility = Visibility.Collapsed;
                    Dashboard.Visibility = Visibility.Visible;
                }
                else
                {
                    Dashboard.Visibility = Visibility.Hidden;
                    LoadingMessage.Visibility = RetryStartup.Visibility = Visibility.Visible;
                    LoadingMessage.Text = $"Не удалось открыть учебный кабинет ({args.WebErrorStatus}).";
                }
            };
            web.Navigate(DashboardPage);
        }
        catch (Exception ex)
        {
            RetryStartup.Visibility = Visibility.Visible;
            LoadingMessage.Text = $"Не удалось открыть приложение. Проверьте установку Microsoft Edge WebView2 Runtime.\n{ex.Message}";
        }
    }

    private static string BuildPage()
    {
        var assembly = Assembly.GetExecutingAssembly();
        string Read(string name)
        {
            using var resource = assembly.GetManifestResourceStream($"KalugaCampus.Ui.{name}")
                ?? throw new InvalidOperationException($"Отсутствует ресурс {name}.");
            using var reader = new StreamReader(resource);
            return reader.ReadToEnd();
        }

        string image = "none";
        using var hero = assembly.GetManifestResourceStream("KalugaCampus.Ui.hero.jpg");
        if (hero is not null)
        {
            using var buffer = new MemoryStream();
            hero.CopyTo(buffer);
            image = $"url(data:image/jpeg;base64,{Convert.ToBase64String(buffer.ToArray())})";
        }
        return Read("index.html")
            .Replace("/* CAMPUS_STYLES */", Read("style.css").Replace("/* HERO */", image))
            .Replace("/* CAMPUS_WORK_BOARD */", Read("workboard.js"))
            .Replace("/* CAMPUS_LKS_UI */", Read("lks-ui.js"))
            .Replace("/* CAMPUS_LAB_UI */", Read("lab-ui.js"))
            .Replace("/* CAMPUS_SCRIPT */", Read("app.js"));
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != DashboardPage)
            return;

        var id = 0L;
        object reply;
        activeRequests++;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var request = message.RootElement;
            id = request.Number("id");
            if (changingAccount) throw new MoodleException("Дождитесь обновления профиля.");
            object? result = request.Text("action") switch
            {
                "open" => await OpenOfficialPageAsync(request.Text("url")),
                "signIn" => await SignInAsync(),
                "showLoginForm" => (request.Text("service") == "lks" ? lks : portal)?.RevealLogin() ?? false,
                "cancelAutoLogin" => (request.Text("service") == "lks" ? lks : portal)?.CancelLoading() ?? false,
                "accounts" => accounts.View(),
                "selectAccount" => SelectAccount(request.Text("profileId"),request.Text("newName")),
                "renameAccount" => accounts.Rename(request.Text("profileId"),request.Text("newName")),
                "deleteAccount" => await DeleteAccountAsync(request.Text("profileId")),
                "setAutoLogin" => accounts.SetAutoLogin(request.Text("profileId"),request.GetProperty("enabled").GetBoolean()),
                "editLogin" => await EditLoginAsync(),
                "forgetLogin" => ForgetLogin(),
                "theme" => SetTheme(request.Text("mode") == "dark"),
                "academicCalendar" => await MoodleClient.GetAcademicCalendarAsync(),
                "progress" or "sessions" or "connectLks" => await ReadLksAsync(request.Text("action")),
                "schedule" => await MoodleClient.GetGroupScheduleAsync(),
                "disconnectLks" => await DisconnectLksAsync(),
                "progressPage" => await OpenProgressAsync(),
                "connect" => await ConnectAsync(request.Text("token")),
                "refresh" => sessionConnected ? await GetPortal().GetDashboardAsync() : await MoodleClient.GetDashboardAsync(RequireToken()),
                "course" => sessionConnected ? await GetPortal().GetCourseAsync(request.Number("courseId")) :
                    await MoodleClient.GetCourseAsync(RequireToken(), request.Number("courseId")),
                "submission" => sessionConnected ? await GetPortal().GetSubmissionAsync(request.Text("url")) :
                    await MoodleClient.GetSubmissionAsync(RequireToken(), request.Number("assignmentId")),
                "workIndex" => await RequirePortalSession().GetWorkIndexAsync(request.Number("courseId")),
                "activityInfo" => await RequirePortalSession().GetActivityInfoAsync(request.Text("url")),
                "labDetails" => await RequirePortalSession().GetLabAsync(RequireLabId(request)),
                "labEditor" => await OpenLabEditorAsync(RequireLabId(request)),
                "labChooseFiles" => ChooseLabFiles(RequireLabId(request)),
                "labDropFiles" => StageLabFiles(RequireLabId(request), e.AdditionalObjects.OfType<CoreWebView2File>().Select(file => file.Path)),
                "labDiscard" => DiscardLabFiles(RequireLabId(request)),
                "labSave" => await SaveLabAsync(RequireLabId(request), request),
                "disconnect" => await DisconnectAsync(),
                _ => throw new InvalidOperationException("Неизвестное действие.")
            };
            reply = new { id, ok = true, result };
        }
        catch (Exception ex)
        {
            var error = ex switch
            {
                MoodleException => ex.Message,
                TimeoutException or OperationCanceledException => "ЭОС не ответила вовремя. Попробуйте ещё раз.",
                System.Net.Http.HttpRequestException => "Не удалось связаться с ЭОС. Проверьте подключение к сети.",
                _ => "Не удалось выполнить действие."
            };
            reply = new { id, ok = false, error };
        }
        activeRequests--;
        if (!closed)
            Dashboard.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(reply, Json));
    }

    private PortalView GetPortal()
    {
        var environment = webEnvironment ?? throw new MoodleException("Подождите, пока приложение загрузится.");
        if (portal is null)
        {
            portal = new PortalView(environment, SetPortalVisible) { AccountId = accounts.Active, AutoLoginEnabled = () => accounts.AutoLogin };
            portal.LoadingChanged += visible => NotifyLoginLoading("eos", visible);
            portal.SetTheme(darkTheme);
            PortalHost.Content = portal;
            PortalHost.Visibility = Visibility.Hidden;
        }
        return portal;
    }

    private PortalView GetAuxiliaryPortal(bool forLks)
    {
        var host = forLks ? LksHost : ViewerHost;
        ref var current = ref (forLks ? ref lks : ref viewer);
        if (current is not null) return current;
        current = new PortalView(webEnvironment ?? throw new MoodleException("Кабинет загружается."), visible =>
        {
            if (closed) return;
            host.Visibility = visible ? Visibility.Visible : Visibility.Hidden;
            Dashboard.Visibility = visible ? Visibility.Hidden : Visibility.Visible;
        }, forLks) { AccountId = accounts.Active, AutoLoginEnabled = () => accounts.AutoLogin, LksAuthenticated = forLks && accounts.HasSession("lks") };
        if (forLks) current.LoadingChanged += visible => NotifyLoginLoading("lks", visible);
        current.SetTheme(darkTheme);
        host.Content = current;
        host.Visibility = Visibility.Hidden;
        return current;
    }

    private async Task<bool> OpenProgressAsync()
    {
        await AlignLegacyLksLoginAsync();
        await GetAuxiliaryPortal(true).ShowProgressPageAsync();
        return true;
    }

    private async Task<JsonElement> ReadLksAsync(string action)
    {
        await AlignLegacyLksLoginAsync();
        var view = GetAuxiliaryPortal(true);
        var report = await (action switch {
            "connectLks" => view.ConnectLksAsync(),
            "sessions" => view.LoadSessionsAsync(),
            _ => view.LoadProgressAsync()
        });
        accounts.RememberSession("lks", true);
        return report;
    }

    private PortalView RequirePortalSession() =>
        sessionConnected ? GetPortal() : throw new MoodleException("Для лабораторных войдите через МГТУ.");

    private static long RequireLabId(JsonElement request)
    {
        var id = request.Number("assignmentId");
        return id > 0 ? id : throw new MoodleException("Не найден номер лабораторной.");
    }

    private async Task<JsonElement> OpenLabEditorAsync(long id)
    {
        if (labSaving)
            throw new MoodleException("Дождитесь завершения загрузки.");
        var result = await RequirePortalSession().GetLabEditorAsync(id);
        labFiles.Clear();
        activeLabEditor = id;
        return result;
    }

    private void EnsureLabEditor(long id)
    {
        if (!sessionConnected || activeLabEditor != id || labSaving)
            throw new MoodleException("Сначала откройте редактор ответа.");
    }

    private object ChooseLabFiles(long id)
    {
        EnsureLabEditor(id);
        var picker = new OpenFileDialog
        {
            Title = "Файлы ответа на лабораторную",
            Filter = "Все файлы (*.*)|*.*",
            Multiselect = true,
            CheckFileExists = true
        };
        return picker.ShowDialog(this) == true ? StageLabFiles(id, picker.FileNames) : Array.Empty<object>();
    }

    private object[] StageLabFiles(long id, IEnumerable<string> paths)
    {
        EnsureLabEditor(id);
        var candidates = paths.Where(path => !string.IsNullOrWhiteSpace(path)).Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => new FileInfo(path)).ToArray();
        if (candidates.Any(file => !file.Exists))
            throw new MoodleException("Выберите доступные файлы. Папку можно сначала упаковать в архив.");
        var result = new List<object>();
        foreach (var file in candidates)
        {
            var key = Guid.NewGuid().ToString("N");
            labFiles.Add(key, new LabLocalFile(file.FullName, file.Length, file.LastWriteTimeUtc));
            result.Add(new { key, name = file.Name, size = file.Length });
        }
        return result.ToArray();
    }

    private bool DiscardLabFiles(long id)
    {
        if (activeLabEditor == id && !labSaving)
        {
            activeLabEditor = 0;
            labFiles.Clear();
        }
        return true;
    }

    private async Task<JsonElement> SaveLabAsync(long id, JsonElement request)
    {
        EnsureLabEditor(id);
        var keys = request.Get("files").Items().Select(item => item.GetString() ?? "").Distinct().ToArray();
        if (keys.Length == 0)
            throw new MoodleException("Сначала выберите файлы.");

        var paths = keys.Select(key =>
        {
            if (!labFiles.TryGetValue(key, out var selected))
                throw new MoodleException("Выберите файлы для этого ответа заново.");
            var current = new FileInfo(selected.Path);
            if (!current.Exists || current.Length != selected.Size || current.LastWriteTimeUtc != selected.Changed)
                throw new MoodleException("Один из файлов изменился. Уберите его из списка и добавьте снова.");
            return current.FullName;
        }).ToArray();

        labSaving = true;
        try
        {
            var saved = await RequirePortalSession().SaveLabAsync(id, paths,
                request.Get("replace").ValueKind == JsonValueKind.True,
                request.Get("statement").ValueKind == JsonValueKind.True,
                request.Text("statementText"));
            labFiles.Clear();
            activeLabEditor = 0;
            return saved;
        }
        finally
        {
            labSaving = false;
        }
    }

    private sealed record LabLocalFile(string Path, long Size, DateTime Changed);

    private void NotifyLoginLoading(string service, bool visible)
    {
        if (!closed)
            Dashboard.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { loginLoading = visible, service }));
    }

    private void SetPortalVisible(bool visible)
    {
        if (closed)
            return;
        Dashboard.Visibility = visible ? Visibility.Hidden : Visibility.Visible;
        PortalHost.Visibility = visible ? Visibility.Visible : Visibility.Hidden;
    }

    private async Task<StudyData?> SignInAsync()
    {
        var eos = GetPortal();
        eos.RestoreEosSession = accounts.HasSession("eos");
        var data = await eos.SignInAsync();
        if (data is not null)
        {
            token = null;
            sessionConnected = true;
            accounts.RememberSession("eos", true);
        }
        return data;
    }

    private async Task<StudyData> ConnectAsync(string candidate)
    {
        candidate = candidate.Trim();
        if (candidate.Length is < 16 or > 256 || candidate.Any(char.IsWhiteSpace))
            throw new MoodleException("Введите токен веб-сервиса Moodle.");

        var data = await MoodleClient.GetDashboardAsync(candidate);
        ClosePortal();
        token = candidate;
        return data;
    }

    private string RequireToken() => token ?? throw new MoodleException("Сначала подключите ЭОС.");

    private async Task<bool> DisconnectAsync()
    {
        await GetPortal().ClearSessionAsync();
        accounts.RememberSession("eos", false);
        ClosePortal();
        token = null;
        return true;
    }

    private bool SelectAccount(string id,string newName)
    {
        if (activeRequests > 1 || labSaving) throw new MoodleException("Дождитесь завершения текущей операции и повторите.");
        accounts.Select(id,newName);
        lks?.EndSession();
        lks = null;
        LksHost.Content = null;
        LksHost.Visibility = Visibility.Collapsed;
        ClosePortal();
        token = null;
        return true;
    }

    private async Task AlignLegacyLksLoginAsync()
    {
        var old = CampusVault.Username(accounts.Active,"lks");
        var shared = CampusVault.Username(accounts.Active,"eos");
        if (old == null || shared == null) return;
        if (!string.Equals(old,shared,StringComparison.OrdinalIgnoreCase)) await DisconnectLksAsync();
        CampusVault.Forget(accounts.Active,"lks");
    }

    private async Task<bool> DeleteAccountAsync(string id)
    {
        accounts.RequireActive(id);
        if (activeRequests > 1 || labSaving) throw new MoodleException("Дождитесь завершения текущей операции и повторите.");
        changingAccount = true;
        try
        {
            await DisconnectLksAsync();
            await DisconnectAsync();
            accounts.Remove(id);
            return true;
        }
        finally { changingAccount = false; }
    }

    private async Task<object> EditLoginAsync()
    {
        var previous = CampusVault.SharedUsername(accounts.Active);
        var editor = new LoginEditor(accounts.Active,accounts.Profiles()[accounts.Active],darkTheme) { Owner = this };
        if (editor.ShowDialog() == true)
        {
            if (!string.Equals(previous, CampusVault.SharedUsername(accounts.Active), StringComparison.OrdinalIgnoreCase))
            {
                await DisconnectLksAsync();
                await DisconnectAsync();
                CampusVault.Forget(accounts.Active,"lks");
            }
            else await AlignLegacyLksLoginAsync();
        }
        return accounts.View();
    }

    private object ForgetLogin()
    {
        CampusVault.ForgetShared(accounts.Active);
        return accounts.View();
    }

    private async Task<bool> OpenOfficialPageAsync(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length > 0)
            throw new MoodleException("Ссылка должна вести на официальный сайт.");

        if (PortalView.IsEosPage(uri.AbsoluteUri))
        {
            await GetAuxiliaryPortal(false).ShowPageAsync(uri.AbsoluteUri);
            return true;
        }
        if (uri.Host != "lks.bmstu.ru" || uri.AbsolutePath != "/profile")
            throw new MoodleException("Ссылка должна вести на официальный сайт.");

        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        return true;
    }

    private void ClosePortal()
    {
        viewer?.EndSession();
        viewer = null;
        ViewerHost.Content = null;
        ViewerHost.Visibility = Visibility.Collapsed;
        sessionConnected = false;
        activeLabEditor = 0;
        labFiles.Clear();
        var current = portal;
        portal = null;
        current?.EndSession();
        SetPortalVisible(false);
        PortalHost.Content = null;
    }

    private async Task<bool> DisconnectLksAsync()
    {
        await GetAuxiliaryPortal(true).ClearSessionAsync();
        accounts.RememberSession("lks", false);
        lks?.EndSession();
        lks = null;
        LksHost.Content = null;
        LksHost.Visibility = Visibility.Collapsed;
        return true;
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        base.OnClosing(e);
        if (!e.Cancel)
        {
            lks?.EndSession();
            ClosePortal();
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        closed = true;
        token = null;
        Dashboard.Dispose();
        base.OnClosed(e);
    }
}
