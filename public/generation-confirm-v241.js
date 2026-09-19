(function (root) {
  'use strict';
  root.NagaGenerationConfirmV241 = Object.freeze({
    ask(document, destination, count) {
      const dialog = document.getElementById('generatorSaveDialogV241');
      const description = document.getElementById('generatorSaveDescriptionV241');
      if (destination?.kind !== "shared" || !dialog || !description || dialog.open || !Number.isSafeInteger(count) || count < 1) return Promise.resolve(false);
      description.textContent = `保存先「${destination.label}」へ${count}問を追加します。この問題集の利用者に反映されます。`;
      dialog.returnValue = '';
      return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'add'), { once: true });
        dialog.showModal();
      });
    }
  });
})(window);
