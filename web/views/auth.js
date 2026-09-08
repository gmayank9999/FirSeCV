import * as api from "../lib/api.js";
import { el, toast, spinnerButton } from "../lib/ui.js";

export function renderAuth(host, onSuccess) {
  let mode = "login";

  const email = el("input", { type: "email", class: "input", placeholder: "you@example.com", autocomplete: "email" });
  const password = el("input", { type: "password", class: "input", placeholder: "Password", autocomplete: "current-password" });
  const submit = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Log in");
  const toggle = el("button", { class: "link-btn" }, "New here? Create an account");
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
  };

  toggle.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

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
      el("div", { class: "row", style: "justify-content:center" }, [toggle]),
    ]),
  ]));

  setMode("login");
  email.focus();
}
