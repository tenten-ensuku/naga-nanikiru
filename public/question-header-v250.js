/* The title uses the existing native question selector; no data requests here. */
(function () {
  function create(doc) {
    const more = doc.getElementById('questionMoreV250');
    const summary = more.querySelector('summary');
    function close(restoreFocus = false) {
      if (!more.open) return;
      more.open = false;
      if (restoreFocus) summary.focus();
    }
    doc.addEventListener('click', event => {
      if (!more.contains(event.target)) close();
    });
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape' && more.open) {
        event.preventDefault();
        close(true);
      }
    });
    more.addEventListener('focusout', event => {
      if (event.relatedTarget && !more.contains(event.relatedTarget)) close();
    });
    // Close before the existing import handler opens its modal. Returning focus
    // to the summary also gives that modal a visible focus target on dismissal.
    more.querySelector('.question-more-panel-v250').addEventListener('click', event => {
      if (event.target.closest('a, button')) close(true);
    }, true);
    return {
      close,
      render(number, type) {
        doc.getElementById('questionTitleNumberV250').textContent = `問題${number}`;
        doc.getElementById('questionTitleTypeV250').textContent = type;
        doc.getElementById('questionPageTitle').setAttribute('aria-label', `問題${number}　${type}`);
        close();
      }
    };
  }
  window.MinkiruQuestionHeaderV250 = { create };
})();
