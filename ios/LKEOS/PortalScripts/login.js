if (window !== top || location.href !== source) return false;
const routes = {
  "https://sso.bmstu.ru/portal4/oauth2/authorize":["form#form","login","/portal4/local","button.btn-primary[type=submit]"],
  "https://sso.bmstu.ru/portal4/local":["form#form","login","/portal4/local","button.btn-primary[type=submit]"],
  "https://sso.bmstu.ru/kc/realms/ph/protocol/openid-connect/auth":["form#kc-form-login","username","/kc/realms/ph/login-actions/authenticate","#kc-login"],
  "https://sso.bmstu.ru/kc/realms/ph/login-actions/authenticate":["form#kc-form-login","username","/kc/realms/ph/login-actions/authenticate","#kc-login"],
  "https://e-learning.bmstu.ru/kaluga/login/index.php":["form#login","username","/kaluga/login/index.php","#loginbtn"]
};
const spec=routes[location.origin+location.pathname];
if (!spec) return false;
const form=document.querySelector(spec[0]);
if (!form || form.method !== "post") return false;
const target=new URL(form.action);
if (target.origin !== location.origin || target.pathname !== spec[2]) return false;
const user=form.elements.namedItem(spec[1]), secret=form.querySelector("input[name=password][type=password]"), button=form.querySelector(spec[3]);
if (!(user instanceof HTMLInputElement) || !secret || !button || button.form !== form || button.type !== "submit" ||
  button.hasAttribute("formaction") || button.hasAttribute("formtarget") || button.hasAttribute("formmethod")) return false;
if ((user.value && user.value !== login) || (secret.value && secret.value !== password)) return false;
user.value=login; secret.value=password;
for (const input of [user,secret]) for (const event of ["input","change"]) input.dispatchEvent(new Event(event,{bubbles:true}));
if (!form.checkValidity() || form.action !== target.href || button.disabled) return false;
button.click(); return true;
