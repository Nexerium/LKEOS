using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using Microsoft.Win32;

namespace KalugaCampus;

internal sealed class Accounts
{
    private readonly string settings;
    internal const string DefaultId = "default";
    internal string Active { get; private set; }
    internal Accounts(string settings = @"Software\KalugaCampus\Accounts")
    {
        this.settings = settings;
        using var root = Registry.CurrentUser.OpenSubKey(settings);
        var id = root?.GetValue("Active") as string;
        var profiles = Profiles();
        Active = id != null && profiles.ContainsKey(id) ? id : profiles.Keys.First();
    }
    internal Dictionary<string,string> Profiles()
    {
        var profiles = new Dictionary<string,string>();
        using var root = Registry.CurrentUser.OpenSubKey(settings);
        if (root?.GetValue("DefaultRemoved") is not 1)
            profiles[DefaultId] = root?.GetValue(DefaultId) as string ?? "Основной";
        if (root != null)
            foreach (var key in root.GetValueNames())
                if (Guid.TryParseExact(key, "N", out _) && root.GetValue(key) is string label)
                    profiles[key] = label;
        return profiles;
    }
    internal void Select(string id, string newName)
    {
        using var root = Registry.CurrentUser.CreateSubKey(settings);
        if (newName.Length > 0)
        {
            var label = ValidateName(newName);
            id = Guid.NewGuid().ToString("N");
            root.SetValue(id,label);
        }
        else if (!Profiles().ContainsKey(id)) throw new MoodleException("Профиль не найден.");
        root.SetValue("Active",id);
        Active = id;
    }
    private string ValidateName(string name, string? except = null)
    {
        var label = name.Trim();
        if (label.Length is < 1 or > 60 || Profiles().Any(p=>p.Key != except && string.Equals(p.Value,label,StringComparison.OrdinalIgnoreCase)))
            throw new MoodleException("Введите уникальное название профиля длиной до 60 символов.");
        return label;
    }
    internal void RequireActive(string id)
    {
        if (id != Active || !Profiles().ContainsKey(id)) throw new MoodleException("Активный профиль изменился.");
    }
    internal object Rename(string id,string name)
    {
        RequireActive(id);
        using var root = Registry.CurrentUser.CreateSubKey(settings);
        root.SetValue(id,ValidateName(name,id));
        return View();
    }
    internal bool AutoLogin
    {
        get { using var root = Registry.CurrentUser.OpenSubKey(settings); return root?.GetValue(Active+".AutoLogin") is not 0; }
    }
    internal object SetAutoLogin(string id, bool enabled)
    {
        RequireActive(id);
        using var root = Registry.CurrentUser.CreateSubKey(settings);
        root.SetValue(id+".AutoLogin",enabled ? 1 : 0);
        return View();
    }
    internal void Remove(string id)
    {
        RequireActive(id);
        CampusVault.ForgetShared(id);
        using var root = Registry.CurrentUser.CreateSubKey(settings);
        var next = Profiles().Keys.FirstOrDefault(key=>key != id);
        if (next == null)
        {
            next = Guid.NewGuid().ToString("N");
            root.SetValue(next,"Основной");
        }
        root.SetValue("Active",next);
        if (id == DefaultId) root.SetValue("DefaultRemoved",1);
        foreach (var key in new[]{id,id+".AutoLogin",id+".eos",id+".lks"}) root.DeleteValue(key,false);
        Active = next;
    }
    internal bool HasSession(string service)
    {
        using var root = Registry.CurrentUser.OpenSubKey(settings);
        return root?.GetValue($"{Active}.{service}") is int value && value == 1;
    }
    internal void RememberSession(string service, bool connected)
    {
        using var root = Registry.CurrentUser.CreateSubKey(settings);
        if (connected) root.SetValue($"{Active}.{service}", 1);
        else root.DeleteValue($"{Active}.{service}", false);
    }
    internal object View() => new {active = Active, restoreEos = HasSession("eos"), restoreLks = HasSession("lks"), profiles = Profiles().Select(pair => new {id = pair.Key, name = pair.Value}),
        autoLogin = AutoLogin, eos = CampusVault.SharedUsername(Active)};
}

internal static class CampusVault
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags, Type;
        public string Target;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME Written;
        public uint Size;
        public IntPtr Blob;
        public uint Persist, AttributesCount;
        public IntPtr Attributes, Alias;
        public string User;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Read(string name,uint type,uint flags,out IntPtr pointer);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool Remove(string name,uint type,uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr pointer);
    private static string Target(string id,string service)
    {
        if ((id != Accounts.DefaultId && !Guid.TryParseExact(id,"N",out _)) || service is not ("eos" or "lks"))
            throw new MoodleException("Неизвестный профиль или сервис.");
        return $"KalugaCampus/{id}/{service}";
    }
    private static T? ReadValue<T>(string id,string service,Func<Credential,T> select) where T:class
    {
        if (!Read(Target(id,service),1,0,out var ptr))
        {
            if (Marshal.GetLastWin32Error() == 1168) return null;
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        try { return select(Marshal.PtrToStructure<Credential>(ptr)); }
        finally { CredFree(ptr); }
    }
    internal static string? Username(string id,string service) => ReadValue(id,service,c => c.User);
    internal static string? SharedUsername(string id) => Username(id,"eos") ?? Username(id,"lks");
    internal static Login? SharedLogin(string id) => ForLogin(id,"eos") ?? ForLogin(id,"lks");
    internal static void ForgetShared(string id)
    {
        Forget(id,"lks");
        Forget(id,"eos");
    }
    internal static Login? ForLogin(string id,string service) => ReadValue(id,service,c =>
        new Login(c.User, Marshal.PtrToStringUni(c.Blob,checked((int)c.Size / 2)) ?? ""));
    internal sealed class Login(string username,string password)
    {
        public string Username { get; } = username;
        public string Password { get; } = password;
    }
    internal static void Save(string id,string service,string username,SecureString password)
    {
        if (string.IsNullOrWhiteSpace(username) || password.Length is 0 or > 1280)
            throw new MoodleException("Введите логин и пароль длиной до 1280 символов.");
        var blob = Marshal.SecureStringToGlobalAllocUnicode(password);
        try
        {
            var credential = new Credential { Type=1, Target=Target(id,service), User=username.Trim(),
                Blob=blob, Size=(uint)password.Length*2, Persist=2 };
            if (!Write(ref credential,0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { Marshal.ZeroFreeGlobalAllocUnicode(blob); }
    }
    internal static void Forget(string id,string service)
    {
        if (!Remove(Target(id,service),1,0) && Marshal.GetLastWin32Error()!=1168)
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
