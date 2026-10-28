import { useState } from 'react';
import { useAction, useToast } from '../ui';
import { Icon } from '../icons';
import {
  DevicePrinter, getDevicePrinter, listBluetooth, listUsb, printBillOn, setDevicePrinter, supportedKinds, testTicket,
} from '../devicePrinter';

const KIND_LABEL = { bluetooth: 'Bluetooth', usb: 'USB cable', network: 'Wi-Fi / LAN' } as const;

/** Connect a thermal printer to this phone, tablet or PC. */
export default function PrinterSetup() {
  const toast = useToast();
  const kinds = supportedKinds();
  const [saved, setSaved] = useState<DevicePrinter | null>(getDevicePrinter());
  const [kind, setKind] = useState<DevicePrinter['kind']>(saved?.kind ?? kinds[0] ?? 'bluetooth');
  const [found, setFound] = useState<{ name: string; address?: string; vendorId?: number; productId?: number }[] | null>(null);
  const [host, setHost] = useState(saved?.host ?? '');
  const [port, setPort] = useState(String(saved?.port ?? 9100));
  const [width, setWidth] = useState<DevicePrinter['width']>(saved?.width ?? '58');
  const [bills, setBills] = useState(saved?.bills ?? true);
  const [kots, setKots] = useState(saved?.kots ?? false);
  const { run, busy } = useAction();

  const save = (p: Omit<DevicePrinter, 'width' | 'bills' | 'kots'>) => run(async () => {
    const full: DevicePrinter = { ...p, width, bills, kots };
    await printBillOn(full, testTicket(full));
    setDevicePrinter(full);
    setSaved(full);
    setFound(null);
  }, 'Printer connected. A test slip was printed.');

  const search = () => run(async () => {
    setFound(kind === 'bluetooth' ? await listBluetooth() : await listUsb());
  });

  if (!kinds.length) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head"><h1>Printer</h1></div>
        <div className="card pad stack">
          <b>Install the YorMenu app to print from this device</b>
          <div className="muted">Browsers can't reach Bluetooth or USB receipt printers. In the YorMenu Android app (phones and tablets) you can print over Bluetooth, USB cable or Wi-Fi. On a PC, use the YorMenu desktop app.</div>
          <div className="muted">In a browser, the Print button opens the normal print window instead.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><h1>Printer for this device</h1></div>
      <div className="stack lg">
        {saved && (
          <div className="card pad row between wrap">
            <div><b>🖨 {saved.name}</b><div className="small muted">{KIND_LABEL[saved.kind]} · {saved.width} mm paper · prints {[saved.bills && 'bills', saved.kots && 'KOTs'].filter(Boolean).join(' & ') || 'nothing'}</div></div>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => run(() => printBillOn(saved, testTicket(saved)), 'Test slip sent')}>Test print</button>
              <button className="btn danger" onClick={() => { setDevicePrinter(null); setSaved(null); toast('Printer removed from this device', 'info'); }}>Remove</button>
            </div>
          </div>
        )}

        <div className="card pad stack">
          <h2>{saved ? 'Change printer' : 'Connect a printer'}</h2>
          <div className="segmented" style={{ alignSelf: 'start' }}>
            {kinds.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setFound(null); }}>{KIND_LABEL[k]}</button>)}
          </div>
          <div className="grid2">
            <label>Paper width
              <select value={width} onChange={(e) => setWidth(e.target.value as DevicePrinter['width'])}>
                <option value="58">58 mm (2 inch, most portable printers)</option>
                <option value="80">80 mm (3 inch)</option>
              </select>
            </label>
            <div className="stack" style={{ gap: 4 }}>
              <label className="check"><input type="checkbox" checked={bills} onChange={(e) => setBills(e.target.checked)} />Print bills here</label>
              <label className="check"><input type="checkbox" checked={kots} onChange={(e) => setKots(e.target.checked)} />Print KOTs here</label>
            </div>
          </div>

          {kind === 'bluetooth' && (
            <>
              <ol className="steps small">
                <li>Switch on the printer.</li>
                <li>Pair it in the phone's <b>Settings → Bluetooth</b> (PIN is usually 0000 or 1234).</li>
                <li>Come back here and tap <b>Find paired printers</b>.</li>
              </ol>
              <button className="btn primary" disabled={busy} onClick={search}><Icon name="printer" size={16} />Find paired printers</button>
            </>
          )}
          {kind === 'usb' && (
            <>
              <div className="small muted">Connect the printer with a USB cable (an OTG adapter on phones), switch it on, then search.</div>
              <button className="btn primary" disabled={busy} onClick={search}><Icon name="printer" size={16} />Find USB printers</button>
            </>
          )}
          {kind === 'network' && (
            <>
              <div className="small muted">The printer and this device must be on the same Wi-Fi. Hold the printer's feed button while switching it on to print its IP address.</div>
              <div className="grid2">
                <label>Printer IP address<input value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="192.168.1.50" inputMode="decimal" /></label>
                <label>Port<input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
              </div>
              <button className="btn primary" disabled={busy || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)}
                onClick={() => save({ kind: 'network', name: `Wi-Fi printer ${host}`, host, port: Number(port) || 9100 })}>Connect &amp; test print</button>
            </>
          )}

          {found && (
            found.length === 0
              ? <div className="empty">{kind === 'bluetooth' ? 'No paired printers. Pair it in Bluetooth settings first.' : 'No USB printer found. Check the cable and that the printer is on.'}</div>
              : (
                <div className="stack">
                  {found.map((d) => (
                    <button key={d.address ?? `${d.vendorId}:${d.productId}`} className="btn block" style={{ justifyContent: 'space-between' }} disabled={busy}
                      onClick={() => save(kind === 'bluetooth'
                        ? { kind, name: d.name, address: d.address }
                        : { kind: 'usb', name: d.name, vendorId: d.vendorId, productId: d.productId })}>
                      <span>🖨 {d.name}</span><span className="small muted">Connect &amp; test</span>
                    </button>
                  ))}
                </div>
              )
          )}
        </div>
        <div className="small muted">Works with ESC/POS thermal printers (almost all receipt printers). The printer is saved on this device only. Each phone or tablet can have its own.</div>
      </div>
    </div>
  );
}
