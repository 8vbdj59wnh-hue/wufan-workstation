export function rerenderPreservingInputFocus(rerender, input, selector) {
  const focusState = {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  };

  rerender();
  window.requestAnimationFrame(() => {
    const nextInput = document.querySelector(selector);
    if (!(nextInput instanceof HTMLInputElement) && !(nextInput instanceof HTMLTextAreaElement)) return;
    nextInput.value = focusState.value;
    nextInput.focus({ preventScroll: true });
    if (focusState.selectionStart === null || focusState.selectionEnd === null) return;
    nextInput.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
  });
}
