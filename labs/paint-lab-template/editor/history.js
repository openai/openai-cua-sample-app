export class History {
  constructor(
    onChange = () => {},
    { maxActions = 50, maxBytes = 64 * 1024 * 1024 } = {},
  ) {
    this.onChange = onChange;
    this.maxActions = maxActions;
    this.maxBytes = maxBytes;
    this.entries = [];
    this.position = 0;
    this.serial = 0;
    this.token = 0;
    this.baseToken = 0;
    this.savedToken = null;
  }
  get canUndo() {
    return this.position > 0;
  }
  get canRedo() {
    return this.position < this.entries.length;
  }
  get dirty() {
    return this.savedToken !== this.token;
  }
  push(entry) {
    this.entries.splice(this.position);
    this.entries.push({ ...entry, before: this.token, after: ++this.serial });
    this.token = this.serial;
    this.position++;
    let bytes = this.entries.reduce(
      (total, item) => total + (item.bytes || 0),
      0,
    );
    while (
      this.entries.length &&
      (this.entries.length > this.maxActions || bytes > this.maxBytes)
    ) {
      const removed = this.entries.shift();
      bytes -= removed.bytes || 0;
      this.baseToken = removed.after;
      this.position--;
    }
    this.onChange();
  }
  undo() {
    if (!this.canUndo) return;
    const entry = this.entries[--this.position];
    entry.undo();
    this.token = entry.before;
    this.onChange();
  }
  redo() {
    if (!this.canRedo) return;
    const entry = this.entries[this.position++];
    entry.redo();
    this.token = entry.after;
    this.onChange();
  }
  goTo(position) {
    position = Math.max(0, Math.min(this.entries.length, position));
    while (this.position > position) this.undo();
    while (this.position < position) this.redo();
  }
  markSaved() {
    this.savedToken = this.token;
    this.onChange();
  }
}
