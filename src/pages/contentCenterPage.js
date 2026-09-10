export function renderContentCenterPage() {
  let noteId = window.location.hash.split("/")[1] || "";
  try { noteId = decodeURIComponent(noteId); } catch { noteId = ""; }
  const query = noteId ? "?note=" + encodeURIComponent(noteId) : "";
  return `<section class="content-center-page" aria-label="内容中心"><iframe title="内容中心：下周需求、内容候选与排期" src="/public/content-center/index.html${query}" style="width:100%;height:calc(100vh - 135px);min-height:620px;border:0;border-radius:16px;background:#fff"></iframe></section>`;
}
export function bindContentCenterPageEvents() {}
