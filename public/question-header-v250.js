/* V255: one-row controls, preserving the native selector and safe title text. */
(function () {
  function create(doc) {
    return {
      render(number, type) {
        doc.getElementById('questionTitleNumberV250').textContent = `問題${number}`;
        doc.getElementById('questionTitleTypeV250').textContent = type;
        doc.getElementById('questionPageTitle').setAttribute('aria-label', `問題${number}　${type}`);
      }
    };
  }
  window.MinkiruQuestionHeaderV250 = { create };
})();
