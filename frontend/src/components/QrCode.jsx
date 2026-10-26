import { useEffect, useState } from "react";
import QRCode from "qrcode";

// A scannable QR code for a booking or ticket code, with the code underneath so it can be typed in.
export default function QrCode({ value, label, size = 168 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => { live = false; };
  }, [value, size]);
  return (
    <figure className="qr">
      {src ? <img src={src} width={size} height={size} alt={label} /> : <div className="qr-placeholder" style={{ width: size, height: size }} />}
      <figcaption className="qr-code">{value}</figcaption>
    </figure>
  );
}
