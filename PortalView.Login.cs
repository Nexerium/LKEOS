using System.Text.Json;

namespace KalugaCampus;

public partial class PortalView
{
    // Arm once per explicit portal visit. A rejected POST can render the same form again.
    private bool automaticLoginAvailable;
    internal Func<bool> AutoLoginEnabled { get; init; } = () => true;
    private bool backgroundLogin;
    private ulong navigationId;
    private ulong? submittedNavigation;
    internal bool RestoreEosSession { get; set; }
    internal event Action<bool>? LoadingChanged;

    private void BeginLogin()
    {
        automaticLoginAvailable = AutoLoginEnabled();
        submittedNavigation = null;
        try { backgroundLogin = automaticLoginAvailable && LoadingChanged != null && ((lksMode ? LksAuthenticated : RestoreEosSession) ||
                CampusVault.SharedUsername(AccountId) != null); }
        catch (System.ComponentModel.Win32Exception) { backgroundLogin = false; }
        showPortal(!backgroundLogin);
        if (!backgroundLogin) return;
        LoadingChanged?.Invoke(true);
    }

    private void EndLoading()
    {
        if (!backgroundLogin) return;
        backgroundLogin = false;
        LoadingChanged?.Invoke(false);
    }

    internal bool RevealLogin()
    {
        if (!backgroundLogin || disposing) return false;
        automaticLoginAvailable = false;
        EndLoading();
        showPortal(true);
        return true;
    }

    internal bool CancelLoading()
    {
        if (!backgroundLogin || disposing) return false;
        automaticLoginAvailable = false;
        Browser.CoreWebView2?.Stop();
        EndLoading();
        ReturnToCampus();
        return true;
    }

    private async Task RevealChallengeAsync()
    {
        if (!backgroundLogin || disposing) return;
        var web = Browser.CoreWebView2;
        var source = web.Source;
        var uri = OfficialUri(source);
        if (uri is null || (uri.Host != "sso.bmstu.ru" && !uri.AbsolutePath.StartsWith("/kaluga/login/"))) return;
        var challenge = await web.ExecuteScriptAsync("""
            !!Array.from(document.querySelectorAll('input[autocomplete="one-time-code"],input[name=otp],input[name=totp],input[name=captcha],.alert-danger,#input-error,.kc-feedback-text'))
                .some(el=>el.getClientRects().length && (el.matches('input') || el.textContent.trim()))
            """);
        if (challenge != "true" && submittedNavigation.HasValue && submittedNavigation != navigationId)
            challenge = await web.ExecuteScriptAsync("!!document.querySelector('input[type=password]')?.getClientRects().length");
        if (!disposing && web.Source == source && challenge == "true") RevealLogin();
    }

    private async Task TryAutomaticLoginAsync()
    {
        if (!automaticLoginAvailable || !AutoLoginEnabled()) return;
        var web = Browser.CoreWebView2;
        var uri = OfficialUri(web.Source);
        if (uri is null) return;
        (string? Selector, string? Login, string? Action, string? Submit) formSpec = (uri.Host, uri.AbsolutePath) switch
        {
            ("sso.bmstu.ru", "/portal4/oauth2/authorize" or "/portal4/local") =>
                ("form#form", "login", "/portal4/local", "button.btn-primary[type=submit]"),
            ("sso.bmstu.ru", "/kc/realms/ph/protocol/openid-connect/auth" or "/kc/realms/ph/login-actions/authenticate") =>
                ("form#kc-form-login", "username", "/kc/realms/ph/login-actions/authenticate", "#kc-login"),
            ("e-learning.bmstu.ru", "/kaluga/login/index.php") when !lksMode =>
                ("form#login", "username", "/kaluga/login/index.php", "#loginbtn"),
            _ => default
        };
        if (formSpec.Selector == null) return;
        try
        {
            var source = web.Source;
            var hasForm = await web.ExecuteScriptAsync($"!!document.querySelector({JsonSerializer.Serialize(formSpec.Selector)})");
            if (hasForm != "true" || disposing || !automaticLoginAvailable || web.Source != source) return;
            var saved = CampusVault.SharedLogin(AccountId);
            if (disposing) return;
            if (saved == null) { RevealLogin(); return; }
            var script = $$"""
                (() => {
                  if (window !== window.top || location.origin !== {{JsonSerializer.Serialize(uri.GetLeftPart(UriPartial.Authority))}} ||
                      location.pathname !== {{JsonSerializer.Serialize(uri.AbsolutePath)}}) return;
                  const form = document.querySelector({{JsonSerializer.Serialize(formSpec.Selector)}});
                  if (!form || form.method.toLowerCase() !== 'post') return;
                  const target = new URL(form.action);
                  if (target.origin !== location.origin || target.pathname !== {{JsonSerializer.Serialize(formSpec.Action)}}) return;
                  const login = form.elements.namedItem({{JsonSerializer.Serialize(formSpec.Login)}});
                  const password = form.querySelector('input[type=password][name=password]');
                  if (!(login instanceof HTMLInputElement) || !password ||
                      (password.value && password.value !== {{JsonSerializer.Serialize(saved.Password)}}) ||
                      (login.value && login.value !== {{JsonSerializer.Serialize(saved.Username)}})) return;
                  const button = form.querySelector({{JsonSerializer.Serialize(formSpec.Submit)}});
                  const ready = () => button?.type === 'submit' && button.form === form && !button.matches(':disabled') &&
                    !button.hasAttribute('formaction') && !button.hasAttribute('formmethod') &&
                    !button.hasAttribute('formtarget') && form.action === target.href && form.method === 'post';
                  login.value = {{JsonSerializer.Serialize(saved.Username)}};
                  password.value = {{JsonSerializer.Serialize(saved.Password)}};
                  for (const input of [login,password]) {
                    input.dispatchEvent(new Event('input',{bubbles:true}));
                    input.dispatchEvent(new Event('change',{bubbles:true}));
                  }
                  if (!ready() || !form.checkValidity()) return;
                  button.click();
                  return true;
                })() === true;
                """;
            automaticLoginAvailable = false;
            submittedNavigation = navigationId;
            var sent = await web.ExecuteScriptAsync(script);
            if (!disposing && backgroundLogin && web.Source == source && submittedNavigation == navigationId && sent == "false")
                RevealLogin();
        }
        catch (Exception) { /* The official form remains available for manual entry. */ }
    }
}
