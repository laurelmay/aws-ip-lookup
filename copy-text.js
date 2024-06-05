function temporarilySwapIcon(node, options) {
  const { from, to } = options;
  const replaceAt = node.querySelector('[data-fa-i2svg]');
  replaceAt.classList.remove(from);
  replaceAt.classList.add(to, 'fa-solid');


  setTimeout(() => {
    const replaceAt = node.querySelector('[data-fa-i2svg]');
    replaceAt.classList.remove(to);
    replaceAt.classList.add(from, 'fa-regular');
  }, 750);
}

function temporarilyApplyClass(node, className) {
  node.classList.add(className);
  setTimeout(() => {
    node.classList.remove(className);
  }, 750);
}

export function copyText(text, button, icon) {
  navigator.clipboard.writeText(text)
    .then(() => {
      temporarilyApplyClass(button, 'copy-success');
      temporarilySwapIcon(icon, { from: 'fa-copy', to: 'fa-check' });
    })
    .catch(() => {
      temporarilyApplyClass(button, 'copy-failure');
      temporarilySwapIcon(icon, { from: 'fa-copy', to: 'fa-x' });
      const textNode = button.parentElement.querySelector('span');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    });
}


