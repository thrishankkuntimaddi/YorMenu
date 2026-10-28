package in.yormenu.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;

/**
 * Prints receipts straight from the phone or tablet to a thermal (ESC/POS) printer:
 *  - Bluetooth: portable printers paired in the phone's Bluetooth settings
 *  - USB: printers on a USB / OTG cable
 *  - Wi-Fi / LAN: network printers (usually port 9100)
 * The website makes the ESC/POS bytes; this only delivers them.
 */
@CapacitorPlugin(
    name = "YorPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN }),
        @Permission(alias = "bluetoothLegacy", strings = { Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN })
    }
)
public class YorPrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String USB_PERMISSION = "in.yormenu.app.USB_PERMISSION";

    private String btAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "bluetoothLegacy";
    }

    private boolean hasBt() {
        return getPermissionState(btAlias()) == PermissionState.GRANTED;
    }

    // ---------- Bluetooth ----------

    @PluginMethod
    public void listBluetooth(PluginCall call) {
        if (!hasBt()) {
            requestPermissionForAlias(btAlias(), call, "btListAfterPermission");
            return;
        }
        listBonded(call);
    }

    @PermissionCallback
    private void btListAfterPermission(PluginCall call) {
        if (!hasBt()) {
            call.reject("Allow \"Nearby devices\" for YorMenu to use Bluetooth printers");
            return;
        }
        listBonded(call);
    }

    @SuppressLint("MissingPermission")
    private void listBonded(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) { call.reject("This device has no Bluetooth"); return; }
        if (!adapter.isEnabled()) { call.reject("Turn on Bluetooth first"); return; }
        JSArray list = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() == null ? d.getAddress() : d.getName());
                o.put("address", d.getAddress());
                list.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", list);
        call.resolve(ret);
    }

    @PluginMethod
    public void printBluetooth(PluginCall call) {
        if (!hasBt()) {
            requestPermissionForAlias(btAlias(), call, "btPrintAfterPermission");
            return;
        }
        doBtPrint(call);
    }

    @PermissionCallback
    private void btPrintAfterPermission(PluginCall call) {
        if (!hasBt()) { call.reject("Allow \"Nearby devices\" for YorMenu to use Bluetooth printers"); return; }
        doBtPrint(call);
    }

    @SuppressLint("MissingPermission")
    private void doBtPrint(PluginCall call) {
        String address = call.getString("address");
        byte[] data = bytes(call);
        if (address == null || data == null) { call.reject("Printer or data missing"); return; }
        new Thread(() -> {
            BluetoothAdapter adapter = adapter();
            if (adapter == null || !adapter.isEnabled()) { call.reject("Turn on Bluetooth first"); return; }
            BluetoothSocket socket = null;
            try {
                adapter.cancelDiscovery();
                BluetoothDevice device = adapter.getRemoteDevice(address);
                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP);
                    socket.connect();
                } catch (Exception first) {
                    // Many cheap printers only accept an insecure connection.
                    try { if (socket != null) socket.close(); } catch (Exception ignored) { }
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
                    socket.connect();
                }
                OutputStream out = socket.getOutputStream();
                for (int i = 0; i < data.length; i += 512) {
                    out.write(data, i, Math.min(512, data.length - i));
                    out.flush();
                    Thread.sleep(15);
                }
                Thread.sleep(400); // let the printer take the last bytes before we hang up
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not print on Bluetooth printer. Is it on and paired? (" + e.getMessage() + ")");
            } finally {
                try { if (socket != null) socket.close(); } catch (Exception ignored) { }
            }
        }).start();
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    // ---------- Wi-Fi / LAN ----------

    @PluginMethod
    public void printNetwork(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 9100);
        byte[] data = bytes(call);
        if (host == null || data == null) { call.reject("Printer address or data missing"); return; }
        new Thread(() -> {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(host, port), 6000);
                s.setSoTimeout(6000);
                OutputStream out = s.getOutputStream();
                out.write(data);
                out.flush();
                Thread.sleep(200);
                call.resolve();
            } catch (Exception e) {
                call.reject("Printer at " + host + ":" + port + " did not answer. Same Wi-Fi? (" + e.getMessage() + ")");
            }
        }).start();
    }

    // ---------- USB cable ----------

    @PluginMethod
    public void listUsb(PluginCall call) {
        UsbManager usb = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        JSArray list = new JSArray();
        if (usb != null) {
            for (UsbDevice d : usb.getDeviceList().values()) {
                JSObject o = new JSObject();
                String name = d.getProductName() != null ? d.getProductName() : ("USB device " + d.getVendorId() + ":" + d.getProductId());
                o.put("name", name);
                o.put("deviceName", d.getDeviceName());
                o.put("vendorId", d.getVendorId());
                o.put("productId", d.getProductId());
                list.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", list);
        call.resolve(ret);
    }

    @PluginMethod
    public void printUsb(PluginCall call) {
        UsbManager usb = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        int vendorId = call.getInt("vendorId", -1);
        int productId = call.getInt("productId", -1);
        byte[] data = bytes(call);
        if (usb == null || data == null) { call.reject("USB is not available"); return; }
        UsbDevice device = null;
        for (UsbDevice d : usb.getDeviceList().values()) {
            if (d.getVendorId() == vendorId && d.getProductId() == productId) { device = d; break; }
        }
        if (device == null) { call.reject("USB printer not found. Check the cable."); return; }
        if (usb.hasPermission(device)) { sendUsb(call, usb, device, data); return; }

        final UsbDevice target = device;
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                try { getContext().unregisterReceiver(this); } catch (Exception ignored) { }
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) sendUsb(call, usb, target, data);
                else call.reject("Allow YorMenu to use the USB printer");
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        Intent intent = new Intent(USB_PERMISSION).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        usb.requestPermission(device, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void sendUsb(PluginCall call, UsbManager usb, UsbDevice device, byte[] data) {
        new Thread(() -> {
            UsbInterface intf = null;
            UsbEndpoint outEp = null;
            // Prefer the printer-class interface; otherwise any interface with a bulk OUT endpoint.
            for (int pass = 0; pass < 2 && outEp == null; pass++) {
                for (int i = 0; i < device.getInterfaceCount() && outEp == null; i++) {
                    UsbInterface f = device.getInterface(i);
                    if (pass == 0 && f.getInterfaceClass() != UsbConstants.USB_CLASS_PRINTER) continue;
                    for (int e = 0; e < f.getEndpointCount(); e++) {
                        UsbEndpoint ep = f.getEndpoint(e);
                        if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                            intf = f; outEp = ep; break;
                        }
                    }
                }
            }
            if (outEp == null) { call.reject("This USB device does not look like a printer"); return; }
            UsbDeviceConnection conn = usb.openDevice(device);
            if (conn == null) { call.reject("Could not open the USB printer"); return; }
            try {
                conn.claimInterface(intf, true);
                int size = Math.max(64, outEp.getMaxPacketSize());
                for (int i = 0; i < data.length; i += size * 16) {
                    int len = Math.min(size * 16, data.length - i);
                    byte[] chunk = new byte[len];
                    System.arraycopy(data, i, chunk, 0, len);
                    if (conn.bulkTransfer(outEp, chunk, len, 5000) < 0) throw new Exception("printer did not accept data");
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("USB print failed (" + e.getMessage() + ")");
            } finally {
                try { conn.releaseInterface(intf); } catch (Exception ignored) { }
                conn.close();
            }
        }).start();
    }

    private byte[] bytes(PluginCall call) {
        String b64 = call.getString("data");
        if (b64 == null) return null;
        try { return Base64.decode(b64, Base64.DEFAULT); } catch (Exception e) { return null; }
    }
}
