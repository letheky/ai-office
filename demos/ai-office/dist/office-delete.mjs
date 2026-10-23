// Password confirmation for deleting AI Office projects and conversations.
export function deletePassword(title, description, {submitText='Xóa'} = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'office-delete-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const heading = document.createElement('h3'); heading.textContent = title;
    const note = document.createElement('p'); note.textContent = description;
    const label = document.createElement('label'); label.textContent = 'Mật khẩu đăng nhập phần mềm';
    const input = document.createElement('input'); input.type = 'password'; input.required = true; input.autocomplete = 'current-password';
    label.append(input);
    const actions = document.createElement('div'); actions.className = 'office-delete-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Giữ lại';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = submitText; submit.className = 'office-delete-confirm';
    actions.append(cancel, submit); form.append(heading, note, label, actions); dialog.append(form);
    document.body.append(dialog);
    let password = null;
    cancel.onclick = () => dialog.close();
    form.onsubmit = event => { event.preventDefault(); password = input.value; dialog.close(); };
    dialog.onclose = () => { dialog.remove(); resolve(password); };
    dialog.showModal(); input.focus();
  });
}
