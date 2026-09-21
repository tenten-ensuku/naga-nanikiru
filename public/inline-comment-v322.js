(function (root) {
  'use strict';
  let home, form, input, selection;
  function prepare() {
    if (form) return true;
    form = root.document.getElementById('commentForm');
    input = root.document.getElementById('commentInput');
    if (!form || !input) return false;
    home = root.document.createComment('inline comment form home');
    form.before(home);
    return true;
  }
  // Keep the actual editor node (listeners, draft, attachments) through list refreshes.
  function beforeRender() {
    if (!prepare() || !form.classList.contains('is-inline-v322')) return;
    selection = root.document.activeElement === input
      ? [input.selectionStart,input.selectionEnd,input.selectionDirection,input.scrollTop] : null;
    home.after(form);
  }
  function sync({id,open}) {
    if (!prepare()) return;
    const editing = Boolean(id && open);
    const host = editing ? root.document.querySelector(`.comment-entry[data-comment-id="${root.CSS.escape(String(id))}"] [data-inline-comment-editor]`) : null;
    form.classList.toggle('is-inline-v322',editing);
    const add = root.document.getElementById('commentAddButton');
    if (add) add.hidden = editing;
    if (editing) {
      // Never fall back to a second editor at the bottom if the target disappears.
      if (host && form.parentNode !== host) host.append(form);
      form.hidden = !host;
      input.style.removeProperty('height');
    } else if (form.parentNode !== home.parentNode && !form.closest('.mobile-comment-dialog-v316')) {
      home.after(form);
    }
    if (selection && host) {
      input.focus({preventScroll:true});
      input.setSelectionRange(...selection.slice(0,3));
      input.scrollTop = selection[3];
    }
    selection = null;
  }
  function focusEditor() {
    if (!form || form.hidden) return;
    form.scrollIntoView({block:'nearest',inline:'nearest'});
    input.focus({preventScroll:true});
  }
  root.MinkiruInlineCommentV322 = {beforeRender,sync,focusEditor};
})(window);
