// Keep a user-chosen conversation name separate from each turn's question.
export function renameConversation(currentName, save) {
  const dialog = document.createElement('dialog');
  dialog.className = 'office-delete-dialog';
  const form = document.createElement('form');
  const heading = document.createElement('h3'); heading.textContent = 'Đổi tên luồng công việc';
  const label = document.createElement('label'); label.textContent = 'Tên luồng';
  const input = document.createElement('input');
  input.type = 'text'; input.required = true; input.maxLength = 120;
  input.value = String(currentName || '').slice(0, 120);
  label.append(input);
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'office-delete-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Hủy';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Lưu tên';
  actions.append(cancel, submit); form.append(heading, label, error, actions); dialog.append(form);
  document.body.append(dialog);
  let saving = false;
  cancel.onclick = () => dialog.close();
  dialog.oncancel = event => { if (saving) event.preventDefault(); };
  dialog.onclose = () => dialog.remove();
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving) return;
    const name = input.value.trim();
    if (!name) { input.setCustomValidity('Vui lòng nhập tên luồng'); input.reportValidity(); return; }
    saving = true; submit.disabled = cancel.disabled = input.disabled = true; error.hidden = true;
    try { await save(name); dialog.close(); }
    catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { saving = false; submit.disabled = cancel.disabled = input.disabled = false; }
  };
  input.oninput = () => input.setCustomValidity('');
  dialog.showModal(); input.focus(); input.select();
}
