import { useState } from "react";

export function Avatar({
  src,
  name,
  size = 30,
}: {
  src?: string;
  name: string;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src && !err) {
    return (
      <img
        className="pco-avatar"
        style={{ width: size, height: size }}
        src={src}
        alt={name}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <span
      className="pco-avatar initials"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

export function MicCard({
  name,
  photo,
  position,
  value,
  count,
  fromTemplate,
  conflict,
  deskMuted,
  onChange,
}: {
  name: string;
  photo?: string;
  position?: string;
  value: string;
  count: number;
  fromTemplate?: boolean;
  conflict?: boolean;
  /** Live mute state of this mic's mapped Avantis channel (undefined = not
   *  mapped, or the desk hasn't reported it yet). */
  deskMuted?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`mic-card ${conflict ? "conflict" : ""} ${deskMuted ? "desk-muted" : ""}`}>
      <Avatar src={photo} name={name} size={52} />
      <span className="mic-card-name" title={name}>
        {name}
      </span>
      {position && <span className="mic-card-pos">{position}</span>}
      {deskMuted === true && <span className="mic-card-muted">MUTED on desk</span>}
      {deskMuted === false && <span className="mic-card-live">live</span>}
      <MicSelect
        value={value}
        count={count}
        fromTemplate={fromTemplate}
        conflict={conflict}
        onChange={onChange}
      />
    </div>
  );
}

export function MicSelect({
  value,
  count,
  fromTemplate,
  conflict,
  onChange,
}: {
  value: string;
  count: number;
  fromTemplate?: boolean;
  conflict?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className={`input mic-select ${fromTemplate ? "tmpl" : ""} ${conflict ? "conflict" : ""}`}
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      title={fromTemplate ? "From template" : undefined}
    >
      <option value="">—</option>
      {Array.from({ length: count }, (_, i) => String(i + 1)).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
