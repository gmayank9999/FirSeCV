import * as api from "../lib/api.js";
import { el, toast, spinnerButton } from "../lib/ui.js";

export function renderAuth(host, onSuccess) {
  let mode = "login";

  const email = el("input", { type: "email", class: "input", placeholder: "you@example.com", autocomplete: "email" });
  const password = el("input", { type: "password", class: "input", placeholder: "Password", autocomplete: "current-password" });
  const submit = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Log in");
  const toggle = el("button", { class: "link-btn" }, "New here? Create an account");
  const forgot = el("button", { class: "link-btn", type: "button" }, "Forgot password?");
  const title = el("h1", { class: "title" }, "Welcome back");
  const subtitle = el("p", { class: "subtitle" }, "Log in to your JOZY account.");

  const setMode = (m) => {
    mode = m;
    const isLogin = m === "login";
    title.textContent = isLogin ? "Welcome back" : "Create your account";
    subtitle.textContent = isLogin
      ? "Log in to your applications, resumes and requisitions."
      : "One account for your job search and your hiring.";
    submit.textContent = isLogin ? "Log in" : "Sign up";
    toggle.textContent = isLogin ? "New here? Create an account" : "Have an account? Log in";
    password.autocomplete = isLogin ? "current-password" : "new-password";
    forgot.hidden = !isLogin;
  };

  toggle.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  forgot.addEventListener("click", () => renderForgotPassword(host, () => renderAuth(host, onSuccess)));

  const doAuth = async () => {
    const e = email.value.trim();
    const p = password.value;
    if (!e || !p) return toast("Enter your email and password", "error");
    if (p.length < 6) return toast("Password must be at least 6 characters", "error");

    spinnerButton(submit, true);
    try {
      const result = mode === "login" ? await api.login(e, p) : await api.signup(e, p);
      if (!result.accessToken) {
        toast("Account created. Check your email to confirm, then log in.", "success");
        setMode("login");
        return;
      }
      api.session.set({ accessToken: result.accessToken, user: result.user });
      await onSuccess();
    } catch (err) {
      toast(err.message || "Authentication failed", "error");
    } finally {
      spinnerButton(submit, false);
    }
  };

  submit.addEventListener("click", doAuth);
  for (const input of [email, password]) {
    input.addEventListener("keydown", (ev) => ev.key === "Enter" && doAuth());
  }

  host.replaceChildren(el("div", { class: "auth__box" }, [
    el("div", { class: "auth__brand" }, [
      el("img", { src: "/assets/icons/icon128.png", alt: "", width: "48", height: "48", style: "object-fit:contain" }),
      el("div", { class: "stack stack--tight" }, [title, subtitle]),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "field" }, [el("label", {}, "Email"), email]),
      el("div", { class: "field" }, [el("label", {}, "Password"), password]),
      submit,
      el("div", { class: "row row--between" }, [toggle, forgot]),
    ]),
  ]));

  setMode("login");
  email.focus();
}

/** Request the reset email without revealing whether an account exists. */
export function renderForgotPassword(host, onBack) {
  const email = el("input", { type: "email", class: "input", placeholder: "you@example.com", autocomplete: "email" });
  const send = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Send reset link");
  send.addEventListener("click", async () => {
    if (!email.value.trim()) return toast("Enter your email address", "error");
    spinnerButton(send, true);
    try {
      await api.requestPasswordReset(email.value.trim());
      toast("If that account exists, a reset link is on its way.", "success");
      onBack();
    } catch (err) {
      toast(err.message || "Could not send a reset link", "error");
    } finally {
      spinnerButton(send, false);
    }
  });
  host.replaceChildren(el("div", { class: "auth__box" }, [
    el("div", { class: "auth__brand" }, [
      el("img", { src: "/assets/icons/icon128.png", alt: "", width: "48", height: "48", style: "object-fit:contain" }),
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, "Reset your password"),
        el("p", { class: "subtitle" }, "We'll email you a secure link to choose a new password."),
      ]),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "field" }, [el("label", {}, "Email"), email]),
      send,
      el("div", { class: "row", style: "justify-content:center" }, [el("button", { class: "link-btn", onclick: onBack }, "Back to log in")]),
    ]),
  ]));
  email.focus();
}

/** The recovery token is supplied by Supabase in the email link fragment. */
export function renderRecoveryPassword(host, accessToken, onDone) {
  const password = el("input", { type: "password", class: "input", autocomplete: "new-password", placeholder: "At least 6 characters" });
  const confirm = el("input", { type: "password", class: "input", autocomplete: "new-password", placeholder: "Repeat new password" });
  const save = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Set new password");
  const submit = async () => {
    if (password.value.length < 6) return toast("Password must be at least 6 characters", "error");
    if (password.value !== confirm.value) return toast("Passwords do not match", "error");
    spinnerButton(save, true);
    try {
      await api.resetPassword(accessToken, password.value);
      toast("Password updated. Log in with your new password.", "success");
      onDone();
    } catch (err) {
      toast(err.message || "This reset link has expired. Request a new one.", "error");
    } finally {
      spinnerButton(save, false);
    }
  };
  save.addEventListener("click", submit);
  confirm.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  host.replaceChildren(el("div", { class: "auth__box" }, [
    el("div", { class: "auth__brand" }, [
      el("img", { src: "/assets/icons/icon128.png", alt: "", width: "48", height: "48", style: "object-fit:contain" }),
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, "Choose a new password"),
        el("p", { class: "subtitle" }, "Use a password you have not used elsewhere."),
      ]),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "field" }, [el("label", {}, "New password"), password]),
      el("div", { class: "field" }, [el("label", {}, "Confirm new password"), confirm]),
      save,
    ]),
  ]));
  password.focus();
}
