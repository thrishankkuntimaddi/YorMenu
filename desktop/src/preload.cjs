const { contextBridge, ipcRenderer } = require('electron');

// The only things the YorMenu website can ask this PC to do: print.
contextBridge.exposeInMainWorld('yormenuDesktop', {
  isDesktop: true,
  /** HTML ticket to the default (USB) printer, no dialog. */
  print: (html) => ipcRenderer.invoke('print:html', String(html)),
  /** ESC/POS bytes to a network thermal printer on the local network. */
  printRaw: (host, port, base64) => ipcRenderer.invoke('print:raw', String(host), Number(port), String(base64)),
});
