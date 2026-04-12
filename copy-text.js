function temporarilySwapClass(node, { from, to }) {
  node.classList.remove(from);
  node.classList.add(to);


  setTimeout(() => {
    node.classList.remove(to);
    node.classList.add(from);
  }, 750);
}

function temporarilyApplyClass(node, className) {
  node.classList.add(className);
  setTimeout(() => {
    node.classList.remove(className);
  }, 750);
}

export function copyText(text, button, icon) {
  const onSuccess = () => {
    temporarilyApplyClass(button, 'copy-success');
    temporarilySwapClass(icon, { from: 'bi-copy', to: 'bi-clipboard-check-fill' });
  };
  const onFailure = () => {
    temporarilyApplyClass(button, 'copy-failure');
    temporarilySwapClass(icon, { from: 'bi-copy', to: 'bi-clipboard-x-fill' });
  };

  const legacyCopyFallback = () => {
    const textNode = button.parentElement.querySelector('span');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      document.execCommand('copy');
      onSuccess();
    } catch {
      onFailure();
    }
    selection.removeAllRanges();
  };

  if (!navigator.clipboard) {
    legacyCopyFallback();
    return;
  }

  navigator.clipboard.writeText(text).then(onSuccess).catch(legacyCopyFallback);
}
