export class Element {
  children: Element[] = [];
  dataset = {};
  text = "";
  tag = "div";
  disabled = false;
  visible = true;
  isShown() { return this.visible; }
  options: any;
  onclick?: () => unknown;
  empty() { this.children = []; }
  addClass() {}
  setText(value: string) { this.text = value; }
  createEl(tag: string, options: any = {}) {
    const element = new Element();
    element.tag = tag;
    element.options = options;
    element.text = options.text ?? "";
    this.children.push(element);
    return element;
  }
  createDiv(options: any = {}) { return this.createEl("div", options); }
  createSpan(options: any = {}) { return this.createEl("span", options); }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
}

export class Plugin {
  app: any;
  commands: any[] = [];
  constructor(app: any) { this.app = app; }
  async loadData() { return {}; }
  async saveData(value: any) { this.app.savedSettings = { ...value }; }
  registerView() {}
  registerEvent() {}
  registerDomEvent() {}
  register() {}
  addSettingTab() {}
  addRibbonIcon() {}
  addCommand(command: any) { this.commands.push(command); }
}
export class ItemView {
  containerEl = new Element();
  app: any;
  constructor(leaf: any) {
    this.app = leaf.app;
    this.containerEl.createDiv();
    this.containerEl.createDiv();
  }
}
export class FileView extends ItemView { file: any; }
export class MarkdownView extends FileView {}
export class PluginSettingTab { constructor(..._args: any[]) {} }
export class Modal {
  contentEl = new Element();
  constructor(public app: any) {}
  onOpen() {}
  onClose() {}
  open() { this.app.openedModals.push(this); this.onOpen(); }
  close() { this.onClose(); }
}
export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}
class Control {
  label = "";
  disabled = false;
  click?: () => unknown;
  options: Record<string, string> = {};
  value = "";
  change?: (value: string) => void;
  inputEl = new Element();
  addOption(key: string, value: string) { this.options[key] = value; return this; }
  setValue(value: string) { this.value = value; return this; }
  onChange(callback: (value: string) => void) { this.change = callback; return this; }
  setIcon() { return this; }
  setTooltip() { return this; }
  setPlaceholder() { return this; }
  setButtonText(value: string) { this.label = value; return this; }
  setCta() { return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onClick(callback: () => unknown) { this.click = callback; return this; }
}
export class Setting {
  static controls: Control[] = [];
  static buttons: Control[] = [];
  static texts: Control[] = [];
  constructor(..._args: any[]) {}
  setName() { return this; }
  setDesc() { return this; }
  addDropdown(callback: (control: Control) => unknown) {
    const control = new Control();
    Setting.controls.push(control);
    callback(control);
    return this;
  }
  addText(callback: (control: Control) => unknown) { const c = new Control(); Setting.texts.push(c); callback(c); return this; }
  addButton(callback: (control: Control) => unknown) { const c = new Control(); Setting.buttons.push(c); callback(c); return this; }
  addExtraButton(callback: (control: Control) => unknown) { callback(new Control()); return this; }
}
export class Menu {
  static shown: Menu[] = [];
  items: any[] = [];
  addItem(callback: (item: any) => void) {
    const item = { title: "", click: undefined as (() => unknown) | undefined,
      setTitle(value: string) { this.title = value; return this; },
      setIcon() { return this; }, onClick(fn: () => unknown) { this.click = fn; return this; } };
    callback(item); this.items.push(item); return this;
  }
  showAtMouseEvent() { Menu.shown.push(this); }
}
export class TFile {}
export class WorkspaceLeaf {}
export const setIcon = () => {};
export const requestUrl = (options: any) => {
  const transport = (globalThis as any).__requestUrl;
  if (transport) return transport(options);
  throw new Error("Unexpected network request");
};
export const normalizePath = (path: string) => path;
export const loadPdfJs = async () => (globalThis as any).__pdfjs;
