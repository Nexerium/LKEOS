using System.Windows;
using System.Windows.Media;

namespace KalugaCampus;
public partial class LoginEditor : Window
{
    private readonly string profile;
    internal LoginEditor(string profile, string name, bool dark)
    {
        this.profile=profile;
        InitializeComponent();
        void SetBrush(string key, string lightColor, string darkColor)
        {
            Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(dark ? darkColor : lightColor));
        }
        SetBrush("Surface", "#FFFFFF", "#111111");
        SetBrush("Ink", "#182842", "#F8F9FA");
        SetBrush("Muted", "#596981", "#B3B3B3");
        SetBrush("Divider", "#E1E8F2", "#292929");
        SetBrush("FieldFill", "#F7F9FC", "#080808");
        SetBrush("Stroke", "#ACB9CA", "#555555");
        SetBrush("Accent", "#245BBB", "#8CC5F4");
        SetBrush("Primary", "#245AB7", "#0058A8");
        SetBrush("ErrorInk", "#AC2639", "#FF929A");
        MaxHeight = SystemParameters.WorkArea.Height;
        ProfileLabel.Text="Профиль · " + name;
        LoginBox.Text=CampusVault.SharedUsername(profile) ?? "";
        Loaded += (_,_) => { if(LoginBox.Text.Length == 0) LoginBox.Focus(); else SecretBox.Focus(); };
    }
    private void OnClose(object sender, RoutedEventArgs e) => DialogResult = false;
    private void OnSave(object sender,RoutedEventArgs e)
    {
        try
        {
            using var password = SecretBox.SecurePassword;
            CampusVault.Save(profile,"eos",LoginBox.Text,password);
            SecretBox.Clear();
            DialogResult=true;
        }
        catch (Exception ex) { ErrorMessage.Text = ex is MoodleException ? ex.Message : "Windows не удалось сохранить данные для входа."; }
    }
}
