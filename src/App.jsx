import { useState, useRef, useCallback } from "react";

// ─── Apply edits to canvas via pixel manipulation (reliable cross-browser) ────
function applyEditsToCanvas(canvas, img, state) {
  const { brightness, contrast, saturation, blur, rotate, filter } = state;

  // Step 1: draw rotated image onto an offscreen canvas
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const rW = Math.round(img.naturalWidth * cos + img.naturalHeight * sin);
  const rH = Math.round(img.naturalWidth * sin + img.naturalHeight * cos);

  const offscreen = document.createElement("canvas");
  offscreen.width = rW; offscreen.height = rH;
  const octx = offscreen.getContext("2d");
  octx.translate(rW / 2, rH / 2);
  octx.rotate(rad);
  octx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  // Step 2: get pixel data and apply colour corrections
  const imageData = octx.getImageData(0, 0, rW, rH);
  const d = imageData.data;

  // Pre-compute lookup tables for brightness/contrast/saturation
  const bFactor = brightness / 100;       // -1 to +1
  const cFactor = (contrast + 100) / 100; // 0 to 2
  const sFactor = (saturation + 100) / 100;

  // Build a filter preset multiplier
  let fBrightness = 1, fContrast = 1, fSaturate = 1, fSepia = 0, fGrayscale = 0;
  if (filter === "grayscale") { fGrayscale = 1; }
  if (filter === "sepia")     { fSepia = 0.8; }
  if (filter === "vintage")   { fSepia = 0.4; fContrast = 1.1; fBrightness = 1.05; fSaturate = 0.8; }
  if (filter === "cinematic") { fContrast = 1.2; fSaturate = 0.8; fBrightness = 0.95; }

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i+1], b = d[i+2];

    // Brightness
    r += bFactor * 255; g += bFactor * 255; b += bFactor * 255;

    // Contrast  (pivot at 128)
    r = (r - 128) * cFactor + 128;
    g = (g - 128) * cFactor + 128;
    b = (b - 128) * cFactor + 128;

    // Saturation
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = gray + (r - gray) * sFactor;
    g = gray + (g - gray) * sFactor;
    b = gray + (b - gray) * sFactor;

    // Filter presets — brightness
    r *= fBrightness; g *= fBrightness; b *= fBrightness;

    // Filter presets — contrast
    r = (r - 128) * fContrast + 128;
    g = (g - 128) * fContrast + 128;
    b = (b - 128) * fContrast + 128;

    // Filter presets — saturation
    const g2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = g2 + (r - g2) * fSaturate;
    g = g2 + (g - g2) * fSaturate;
    b = g2 + (b - g2) * fSaturate;

    // Grayscale
    if (fGrayscale > 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = r + (lum - r) * fGrayscale;
      g = g + (lum - g) * fGrayscale;
      b = b + (lum - b) * fGrayscale;
    }

    // Sepia
    if (fSepia > 0) {
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;
      r = r + (sr - r) * fSepia;
      g = g + (sg - g) * fSepia;
      b = b + (sb - b) * fSepia;
    }

    d[i]   = Math.max(0, Math.min(255, r));
    d[i+1] = Math.max(0, Math.min(255, g));
    d[i+2] = Math.max(0, Math.min(255, b));
  }

  // Step 3: write to output canvas
  canvas.width = rW; canvas.height = rH;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);

  // Step 4: optional blur via CSS filter on a second pass
  if (blur > 0) {
    const blurred = document.createElement("canvas");
    blurred.width = rW; blurred.height = rH;
    const bctx = blurred.getContext("2d");
    bctx.filter = `blur(${blur}px)`;
    bctx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, rW, rH);
    ctx.drawImage(blurred, 0, 0);
  }
}

// ─── Mock AI: converts natural language to JSON editing actions ───────────────
function parsePromptToActions(prompt) {
  const p = prompt.toLowerCase();
  const actions = [];

  // Brightness
  if (p.includes("brighter") || p.includes("brighten") || p.includes("lighter")) actions.push({ type: "brightness", value: 40 });
  else if (p.includes("darker") || p.includes("darken")) actions.push({ type: "brightness", value: -40 });

  // Contrast
  if (p.includes("more contrast") || p.includes("high contrast") || p.includes("punchier")) actions.push({ type: "contrast", value: 40 });
  else if (p.includes("less contrast") || p.includes("low contrast") || p.includes("flat")) actions.push({ type: "contrast", value: -30 });

  // Saturation
  if (p.includes("vivid") || p.includes("vibrant") || p.includes("saturate") || p.includes("colorful")) actions.push({ type: "saturation", value: 50 });
  else if (p.includes("desaturate") || p.includes("muted") || p.includes("faded")) actions.push({ type: "saturation", value: -50 });

  // Blur
  if (p.includes("blur") || p.includes("soft") || p.includes("dreamy")) actions.push({ type: "blur", value: 3 });
  if (p.includes("sharp") || p.includes("crisp")) actions.push({ type: "blur", value: 0 });

  // Rotate
  const rotateMatch = p.match(/rotate\s*(\d+)/);
  if (rotateMatch) actions.push({ type: "rotate", value: parseInt(rotateMatch[1]) });
  else if (p.includes("rotate left")) actions.push({ type: "rotate", value: -90 });
  else if (p.includes("rotate right")) actions.push({ type: "rotate", value: 90 });

  // Filters
  if (p.includes("grayscale") || p.includes("black and white") || p.includes("b&w") || p.includes("monochrome")) actions.push({ type: "filter", value: "grayscale" });
  else if (p.includes("sepia") || p.includes("vintage") || p.includes("old photo") || p.includes("retro")) actions.push({ type: "filter", value: "sepia" });
  else if (p.includes("cinematic") || p.includes("movie") || p.includes("film")) actions.push({ type: "filter", value: "cinematic" });
  else if (p.includes("warm") || p.includes("golden")) actions.push({ type: "filter", value: "vintage" });

  // Reset
  if (p.includes("reset") || p.includes("original") || p.includes("undo all") || p.includes("clear")) actions.push({ type: "reset" });

  if (actions.length === 0) {
    actions.push({ type: "error", message: "Couldn't understand that instruction. Try: 'make it brighter', 'add sepia filter', 'rotate 90'" });
  }

  return actions;
}

// ─── Apply CSS filter string from edit state ──────────────────────────────────
function buildFilterString(state) {
  const { brightness, contrast, saturation, blur, filter } = state;
  let f = "";
  if (brightness !== 0) f += `brightness(${1 + brightness / 100}) `;
  if (contrast !== 0) f += `contrast(${1 + contrast / 100}) `;
  if (saturation !== 0) f += `saturate(${1 + saturation / 100}) `;
  if (blur > 0) f += `blur(${blur}px) `;
  if (filter === "grayscale") f += "grayscale(1) ";
  if (filter === "sepia") f += "sepia(0.8) ";
  if (filter === "vintage") f += "sepia(0.4) contrast(1.1) brightness(1.05) saturate(0.8) ";
  if (filter === "cinematic") f += "contrast(1.2) saturate(0.8) brightness(0.95) ";
  return f.trim();
}

const DEFAULT_STATE = { brightness: 0, contrast: 0, saturation: 0, blur: 0, rotate: 0, filter: null };

// ─── Slider control ───────────────────────────────────────────────────────────
function Slider({ label, icon, value, min, max, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mb-4">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", color: "#94a3b8", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: value === 0 ? "#475569" : "#f1c40f", fontFamily: "'DM Mono', monospace", minWidth: "36px", textAlign: "right" }}>
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      <div style={{ position: "relative", height: "4px", borderRadius: "2px", background: "#1e293b", cursor: "pointer" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: value === 0 ? "#334155" : "linear-gradient(90deg,#f1c40f,#e67e22)", borderRadius: "2px", transition: "width 0.1s" }} />
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }}
        />
      </div>
    </div>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────
function FilterPill({ name, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", borderRadius: "20px", fontSize: "11px", fontWeight: 700,
      fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase",
      border: active ? "1.5px solid #f1c40f" : "1.5px solid #1e293b",
      background: active ? "rgba(241,196,15,0.12)" : "transparent",
      color: active ? "#f1c40f" : "#475569", cursor: "pointer", transition: "all 0.18s"
    }}>
      {label}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PhotoEditor() {
  const [image, setImage] = useState(null);       // data URL
  const [editState, setEditState] = useState(DEFAULT_STATE);
  const [history, setHistory] = useState([DEFAULT_STATE]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [aiLog, setAiLog] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notification, setNotification] = useState(null);
  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  // Show toast notification
  const notify = (msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 2800);
  };

  // Push new state onto history
  const pushState = useCallback((newState) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1);
      return [...trimmed, newState];
    });
    setHistoryIdx(prev => prev + 1);
    setEditState(newState);
  }, [historyIdx]);

  const undo = () => {
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      setHistoryIdx(idx);
      setEditState(history[idx]);
    }
  };

  const redo = () => {
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      setHistoryIdx(idx);
      setEditState(history[idx]);
    }
  };

  // Handle file upload
  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) { notify("Please upload an image file.", "error"); return; }
    const reader = new FileReader();
    reader.onload = e => {
      setImage(e.target.result);
      const reset = { ...DEFAULT_STATE };
      setEditState(reset);
      setHistory([reset]);
      setHistoryIdx(0);
      setAiLog([]);
      notify("Image loaded! Start editing.", "success");
    };
    reader.readAsDataURL(file);
  };

  // Download edited image — renders at full native resolution via pixel manipulation
  const download = () => {
    if (!image || !imgRef.current) { notify("Upload an image first.", "error"); return; }
    notify("Rendering export…", "info");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      applyEditsToCanvas(canvas, img, editState);
      const link = document.createElement("a");
      link.download = "luminary-edit.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      notify("Image downloaded!", "success");
    };
    img.onerror = () => notify("Export failed — try a different image.", "error");
    img.src = image;
  };

  // AI prompt handler
  const handleAiPrompt = async () => {
    if (!prompt.trim()) return;
    if (!image) { notify("Upload an image first!", "error"); return; }
    setAiLoading(true);
    // Simulate async AI call
    await new Promise(r => setTimeout(r, 600));
    const actions = parsePromptToActions(prompt);
    const hasError = actions.find(a => a.type === "error");

    setAiLog(prev => [{ prompt, actions, ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);

    if (hasError) {
      notify(hasError.message, "error");
      setAiLoading(false);
      setPrompt("");
      return;
    }

    let next = { ...editState };
    actions.forEach(action => {
      if (action.type === "reset") next = { ...DEFAULT_STATE };
      else if (action.type === "brightness") next.brightness = Math.max(-100, Math.min(100, next.brightness + action.value));
      else if (action.type === "contrast") next.contrast = Math.max(-100, Math.min(100, next.contrast + action.value));
      else if (action.type === "saturation") next.saturation = Math.max(-100, Math.min(100, next.saturation + action.value));
      else if (action.type === "blur") next.blur = Math.max(0, Math.min(10, action.value));
      else if (action.type === "rotate") next.rotate = (next.rotate + action.value) % 360;
      else if (action.type === "filter") next.filter = action.value === next.filter ? null : action.value;
    });

    pushState(next);
    notify(`Applied: ${actions.map(a => a.type).join(", ")}`, "success");
    setPrompt("");
    setAiLoading(false);
  };

  const filterString = buildFilterString(editState);
  const imgStyle = {
    filter: filterString,
    transform: `rotate(${editState.rotate}deg)`,
    transition: "filter 0.2s, transform 0.3s",
    maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
    borderRadius: "4px",
    display: "block", margin: "auto"
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080d14", color: "#e2e8f0",
      fontFamily: "'Syne', sans-serif", display: "flex", flexDirection: "column"
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #f1c40f; cursor: pointer; }
        textarea:focus, input:focus { outline: none; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>

      {/* Toast */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          padding: "10px 24px", borderRadius: "8px", zIndex: 9999, fontFamily: "'DM Mono', monospace",
          fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em",
          background: notification.type === "error" ? "#7f1d1d" : notification.type === "success" ? "#14532d" : "#1e3a5f",
          border: `1px solid ${notification.type === "error" ? "#ef4444" : notification.type === "success" ? "#22c55e" : "#3b82f6"}`,
          color: "#f1f5f9", animation: "fadeIn 0.3s ease", boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
        }}>
          {notification.type === "error" ? "✗ " : "✓ "}{notification.msg}
        </div>
      )}

      {/* Header */}
      <header style={{ borderBottom: "1px solid #1e293b", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(8,13,20,0.95)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: 32, height: 32, borderRadius: "8px", background: "linear-gradient(135deg,#f1c40f,#e67e22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>⬡</div>
          <span style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.02em" }}>LUMINARY</span>
          <span style={{ fontSize: "10px", fontWeight: 600, fontFamily: "'DM Mono',monospace", color: "#f1c40f", background: "rgba(241,196,15,0.1)", border: "1px solid rgba(241,196,15,0.25)", padding: "2px 8px", borderRadius: "12px", letterSpacing: "0.1em" }}>AI EDITOR</span>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button onClick={undo} disabled={historyIdx === 0} title="Undo" style={{ background: "none", border: "1px solid #1e293b", borderRadius: "6px", color: historyIdx === 0 ? "#334155" : "#94a3b8", padding: "6px 10px", cursor: historyIdx === 0 ? "not-allowed" : "pointer", fontSize: "14px", transition: "all 0.15s" }}>↩</button>
          <button onClick={redo} disabled={historyIdx >= history.length - 1} title="Redo" style={{ background: "none", border: "1px solid #1e293b", borderRadius: "6px", color: historyIdx >= history.length - 1 ? "#334155" : "#94a3b8", padding: "6px 10px", cursor: historyIdx >= history.length - 1 ? "not-allowed" : "pointer", fontSize: "14px", transition: "all 0.15s" }}>↪</button>
          <button onClick={download} style={{ background: "linear-gradient(135deg,#f1c40f,#e67e22)", color: "#000", border: "none", borderRadius: "6px", padding: "7px 18px", fontWeight: 700, fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>
            ↓ Export
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, height: "calc(100vh - 57px)" }}>

        {/* ── LEFT PANEL ── */}
        <aside style={{ width: 220, borderRight: "1px solid #1e293b", padding: "20px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: "12px" }}>Upload</p>

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            style={{
              border: `2px dashed ${dragOver ? "#f1c40f" : "#1e293b"}`,
              borderRadius: "10px", padding: "24px 12px", textAlign: "center",
              cursor: "pointer", transition: "all 0.2s",
              background: dragOver ? "rgba(241,196,15,0.05)" : "rgba(15,23,42,0.5)",
              marginBottom: "16px"
            }}
          >
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>📁</div>
            <p style={{ fontSize: "11px", color: "#64748b", fontFamily: "'DM Mono',monospace", lineHeight: 1.5 }}>
              Drop image here<br/>or click to browse
            </p>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          </div>

          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: "8px" }}>Filters</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
            {[["none","Original"],["grayscale","B&W"],["sepia","Sepia"],["vintage","Warm"],["cinematic","Cinema"]].map(([val,label]) => (
              <FilterPill key={val} name={val} label={label}
                active={val === "none" ? !editState.filter : editState.filter === val}
                onClick={() => pushState({ ...editState, filter: val === "none" ? null : (editState.filter === val ? null : val) })} />
            ))}
          </div>

          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: "8px" }}>Transform</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[["↻ CW 90°", 90],["↺ CCW 90°", -90],["↔ Flip 180°", 180]].map(([label, deg]) => (
              <button key={label} onClick={() => pushState({ ...editState, rotate: (editState.rotate + deg) % 360 })} style={{
                background: "none", border: "1px solid #1e293b", borderRadius: "6px", color: "#94a3b8",
                padding: "8px", cursor: "pointer", fontSize: "11px", fontFamily: "'DM Mono',monospace",
                fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.15s", textAlign: "left"
              }}>{label}</button>
            ))}
          </div>

          <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid #1e293b" }}>
            <button onClick={() => { pushState({ ...DEFAULT_STATE }); notify("Reset to original.", "info"); }} style={{
              width: "100%", background: "none", border: "1px solid #7f1d1d", borderRadius: "6px",
              color: "#ef4444", padding: "8px", cursor: "pointer", fontSize: "11px",
              fontFamily: "'DM Mono',monospace", fontWeight: 700, letterSpacing: "0.08em", transition: "all 0.15s"
            }}>⟳ Reset All</button>
          </div>
        </aside>

        {/* ── CENTER CANVAS ── */}
        <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at center, #0f172a 0%, #080d14 100%)", position: "relative", overflow: "hidden" }}>
          {/* Grid background */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(#1e293b 1px,transparent 1px),linear-gradient(90deg,#1e293b 1px,transparent 1px)", backgroundSize: "40px 40px", opacity: 0.25, pointerEvents: "none" }} />

          {image ? (
            <div style={{ position: "relative", maxWidth: "85%", maxHeight: "85%", width: "auto" }}>
              {/* Glow */}
              <div style={{ position: "absolute", inset: -20, background: "radial-gradient(ellipse,rgba(241,196,15,0.08) 0%,transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <img ref={imgRef} src={image} alt="editing" style={imgStyle} />
            </div>
          ) : (
            <div style={{ textAlign: "center", opacity: 0.3 }}>
              <div style={{ fontSize: "80px", marginBottom: "16px" }}>🖼</div>
              <p style={{ fontSize: "14px", fontFamily: "'DM Mono',monospace", color: "#475569" }}>No image loaded</p>
            </div>
          )}

          {/* Edit state badge */}
          {image && (
            <div style={{ position: "absolute", bottom: 16, left: 16, fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#475569", background: "rgba(8,13,20,0.8)", border: "1px solid #1e293b", borderRadius: "6px", padding: "6px 10px" }}>
              {`✦ ${editState.rotate}° · B${editState.brightness > 0 ? "+" : ""}${editState.brightness} · C${editState.contrast > 0 ? "+" : ""}${editState.contrast} · S${editState.saturation > 0 ? "+" : ""}${editState.saturation}${editState.filter ? ` · ${editState.filter}` : ""}`}
            </div>
          )}
        </main>

        {/* ── RIGHT PANEL ── */}
        <aside style={{ width: 260, borderLeft: "1px solid #1e293b", padding: "20px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: "12px" }}>Adjustments</p>

          <Slider label="Brightness" icon="☀" value={editState.brightness} min={-100} max={100} onChange={v => pushState({ ...editState, brightness: v })} />
          <Slider label="Contrast" icon="◑" value={editState.contrast} min={-100} max={100} onChange={v => pushState({ ...editState, contrast: v })} />
          <Slider label="Saturation" icon="❋" value={editState.saturation} min={-100} max={100} onChange={v => pushState({ ...editState, saturation: v })} />
          <Slider label="Blur" icon="〰" value={editState.blur} min={0} max={10} onChange={v => pushState({ ...editState, blur: v })} />
          <Slider label="Rotate" icon="↻" value={editState.rotate} min={-180} max={180} onChange={v => pushState({ ...editState, rotate: v })} />

          {/* AI Prompt */}
          <div style={{ marginTop: "20px", borderTop: "1px solid #1e293b", paddingTop: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <div style={{ width: 20, height: 20, borderRadius: "4px", background: "linear-gradient(135deg,#f1c40f,#e67e22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px" }}>✦</div>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#f1c40f", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>AI Prompt</p>
            </div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiPrompt(); } }}
              placeholder={"\"make it brighter\"\n\"add sepia filter\"\n\"rotate 90 degrees\"\n\"more contrast\""}
              rows={4}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px",
                color: "#e2e8f0", padding: "10px 12px", fontSize: "12px", fontFamily: "'DM Mono',monospace",
                resize: "none", lineHeight: 1.6, transition: "border-color 0.15s"
              }}
              onFocus={e => e.target.style.borderColor = "#f1c40f"}
              onBlur={e => e.target.style.borderColor = "#1e293b"}
            />
            <button
              onClick={handleAiPrompt}
              disabled={aiLoading || !prompt.trim()}
              style={{
                width: "100%", marginTop: "8px", padding: "10px",
                background: aiLoading || !prompt.trim() ? "#1e293b" : "linear-gradient(135deg,#f1c40f,#e67e22)",
                border: "none", borderRadius: "8px", cursor: aiLoading || !prompt.trim() ? "not-allowed" : "pointer",
                color: aiLoading || !prompt.trim() ? "#475569" : "#000",
                fontWeight: 700, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace", transition: "all 0.2s",
                animation: aiLoading ? "pulse 1s infinite" : "none"
              }}
            >
              {aiLoading ? "⟳ Processing..." : "✦ Apply AI Edit"}
            </button>
          </div>

          {/* AI Log */}
          {aiLog.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#475569", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: "8px" }}>History</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {aiLog.slice(0, 5).map((entry, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "6px", padding: "8px 10px" }}>
                    <p style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "'DM Mono',monospace", marginBottom: "4px", fontStyle: "italic" }}>"{entry.prompt}"</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {entry.actions.map((a, j) => (
                        <span key={j} style={{ fontSize: "9px", fontFamily: "'DM Mono',monospace", padding: "2px 6px", borderRadius: "10px", background: "rgba(241,196,15,0.1)", color: "#f1c40f", border: "1px solid rgba(241,196,15,0.2)" }}>
                          {a.type}{a.value !== undefined ? `: ${a.value}` : ""}
                        </span>
                      ))}
                    </div>
                    <p style={{ fontSize: "9px", color: "#334155", fontFamily: "'DM Mono',monospace", marginTop: "4px" }}>{entry.ts}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
