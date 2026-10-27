// A page with unsaved work sets the question to ask; moving away inside the app asks it first.
let leaveQuestion: string | null = null;
export const guardLeave = (question: string | null) => void (leaveQuestion = question);

// The address of the page on screen, put back when the person presses Back but stays on unsaved work.
let shown = typeof location === "undefined" ? "" : location.href;
export const rememberPage = () => void (shown = location.href);

export function navigate(path: string, replace = false) {
  if (leaveQuestion && !confirm(leaveQuestion)) return;
  leaveQuestion = null;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  shown = location.href;
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}

// The browser's Back and Forward (and swipe back) ask too. False: the person stays, the page is left as it is.
export function allowPop() {
  if (location.href === shown || !leaveQuestion) return true;
  if (confirm(leaveQuestion)) {
    leaveQuestion = null;
    return true;
  }
  history.pushState(null, "", shown);
  return false;
}
