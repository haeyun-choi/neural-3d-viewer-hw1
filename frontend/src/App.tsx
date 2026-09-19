import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrientationControls } from "./OrientationControls";
import { readView, saveView, clearView } from "./viewPreferences";
import { useRegionSelection } from "./useRegionSelection";
import { groupKey, groupColor } from "./annotationGroups";
import type { InteractionMode, SelectionOperationMode } from "./types";
import { AnnotationPanel } from "./AnnotationPanel";
import { PLY_IMPORT_TEXT } from "./ply";
import { useScene } from "./useScene";
import { PointCloudViewer } from "./PointCloudViewer";
import { connectStorage, CorruptStorageError, errorMessage, recoverLocalStorage } from "./storage";
import type { AnnotationStore } from "./storage";
import type {
  Annotation,
  AnnotationInput,
  Position,
  PointCloudData,
  ViewerHandle,
  ViewerStatus,
} from "./types";

export default function App() {
  const [renderStatus, setRenderStatus] = useState<ViewerStatus>({ state: "loading", message: "Preparing viewer…" });
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pointSize, setPointSize] = useState(3);
  const [background, setBackground] = useState("#101827");
  const [store, setStore] = useState<AnnotationStore | null>(null);
  const [records, setRecords] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("navigate");
  const picking = interactionMode === "point";
  const setPicking = (value: boolean) => setInteractionMode(value ? "point" : "navigate");
  const [operationMode, setOperationMode] = useState<SelectionOperationMode>("replace");
  const clearSelection = useRef<() => void>(() => {});
  const [viewRevision, setViewRevision] = useState(0);
  const [viewMessage, setViewMessage] = useState({ scene: "", error: "", notice: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [corruption, setCorruption] = useState<CorruptStorageError | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const viewerArea = useRef<HTMLElement>(null);
  const storageGeneration = useRef(0);
  const selected = records.find((record) => record.id === selectedId) ?? null;

  const activate = useCallback(() => {
    // Invalidate old promises immediately, before React commits the new scene
    // and runs the previous storage effect's cleanup.
    storageGeneration.current += 1;
    clearSelection.current();
    setStore(null);
    setRecords([]);
    setSelectedId(null);
    setSelectedGroup(null);
    setPosition(null);
    setInteractionMode("navigate");
    setError("");
    setNotice("");
    setCorruption(null);
  }, []);
  const prepare = useCallback((cloud: PointCloudData) => {
    if (!viewer.current) throw new Error("Viewer is not ready.");
    viewer.current.prepare(cloud);
  }, []);
  const { loaded, loading, importError, loadStatus, warning, continueImport, cancelImport, openFile, restoreSample } = useScene(activate, prepare);
  const scene = loaded?.metadata;
  const status = loaded ? renderStatus : loadStatus;
  const sceneId = scene?.id ?? "";
  const storedView = useMemo(() => { void viewRevision; return readView(sceneId); }, [sceneId, viewRevision]);
  const selection = useRegionSelection(loaded?.cloud ?? null, setError, (layers) => {
    if (!viewer.current) throw new Error("Viewer is not ready.");
    viewer.current.prepareHighlights(layers);
  });
  const selectedCount = selection.region?.selected_count ?? (position ? 1 : 0);
  useEffect(() => { clearSelection.current = selection.clear; }, [selection.clear]);
  const highlights = useMemo(() => selection.layers.map((layer) => {
    const annotation = records.find((a) => a.id === (layer.key === "draft" ? selectedId : layer.key));
    return annotation ? { ...layer, color: groupColor(groupKey(annotation.category, annotation.label)) } : layer;
  }), [selection.layers, records, selectedId]);
  function saveOrientation(home: boolean) {
    if (!scene || !viewer.current) return;
    try {
      saveView(scene.id, viewer.current.captureView(home));
      setViewRevision((n) => n + 1);
      setViewMessage({ scene: scene.id, error: "", notice: home ? "Front/home saved in this browser." : "Upright saved. Previous home cleared; Set as front to save exact framing." });
    } catch (reason) { setViewMessage({ scene: scene.id, error: errorMessage(reason), notice: "" }); }
  }
  function restoreOrientation() {
    if (!scene) return;
    try {
      clearView(scene.id); viewer.current?.restoreImported(); setViewRevision((n) => n + 1);
      setViewMessage({ scene: scene.id, error: "", notice: "Imported orientation restored; saved front/home cleared." });
    } catch (reason) { setViewMessage({ scene: scene.id, error: errorMessage(reason), notice: "" }); }
  }

  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    const generation = storageGeneration.current;
    void connectStorage(scene)
      .then(({ store: connected, records: saved }) => {
        if (!cancelled && generation === storageGeneration.current) {
          setStore(connected);
          setRecords(saved);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled && generation === storageGeneration.current) {
          setError(errorMessage(reason));
          setCorruption(reason instanceof CorruptStorageError ? reason : null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  const cancel = useCallback(() => {
    clearSelection.current();
    setSelectedId(null);
    setSelectedGroup(null);
    setPosition(null);
    setInteractionMode("navigate");
    setError("");
    setNotice("");
  }, []);
  const select = (annotation: Annotation) => {
    const ready = () => {
      setSelectedId(annotation.id); setSelectedGroup(null);
      setPosition({ x: annotation.x, y: annotation.y, z: annotation.z });
      setInteractionMode("navigate"); setError(""); setNotice("");
    };
    if (annotation.kind === "region") {
      void selection.show([annotation], true, (result) => {
        ready(); if (result.result?.bounds) viewer.current?.focusRegion(result.result.bounds);
      });
    } else { selection.clear(); ready(); viewer.current?.focus(annotation); }
  };
  const pick = useCallback((point: Position) => {
    clearSelection.current();
    setSelectedId(null);
    setSelectedGroup(null);
    setPosition(point);
    setInteractionMode("navigate");
    setError("");
    setNotice("");
  }, []);

  async function save(input: AnnotationInput) {
    if (!store || busy || loading || selection.busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const record = selectedId
        ? await store.update(selectedId, input)
        : await store.create(input);
      setRecords((items) =>
        selectedId
          ? items.map((item) => (item.id === record.id ? record : item))
          : [...items, record],
      );
      if (input.kind === "region") setSelectedId(record.id);
      else { setSelectedId(null); setPosition(null); }
      setInteractionMode("navigate");
      setNotice(
        store.mode === "database"
          ? "Annotation saved to the database."
          : "Annotation saved in this browser only.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
      if (reason instanceof CorruptStorageError) setCorruption(reason);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!store || busy || loading || selection.busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await store.remove(id);
      setRecords((items) => items.filter((item) => item.id !== id));
      cancel();
      setNotice("Annotation deleted.");
    } catch (reason) {
      setError(errorMessage(reason));
      if (reason instanceof CorruptStorageError) setCorruption(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="Neural 3D home"
        >
          <span className="brand-symbol">
            N<span>3</span>
          </span>
          <span>
            Neural <b>3D</b>
            <small>DATA VIEWER</small>
          </span>
        </a>
        <div className="header-right">
          <span className="release-tag">HW1 · FOUNDATION</span>
          <span className={`storage-badge ${store?.mode ?? "connecting"}`}>
            <span className="live-dot" />
            {store?.mode === "database"
              ? "Database connected"
              : store?.mode === "local"
                ? "Local demo mode"
                : error
                  ? "Storage unavailable"
                  : "Connecting storage…"}
          </span>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">EXPLORE / OBSERVE / ANNOTATE</p>
            <h1>A new perspective on your data.</h1>
            <p>Navigate a point cloud and turn details into spatial notes.</p>
          </div>
          <span className="scene-index">
            {scene?.source === "local" ? <>LOCAL <b>PLY</b></> : <>SAMPLE <b>01</b> / 01</>}
          </span>
        </section>
        {store?.mode === "local" && (
          <div className="mode-banner" role="status">
            <span>◉</span>
            <div>
              <strong>Static demo · saved in this browser only</strong>
              <p>
                The backend is unavailable or local mode is configured. Notes
                are separate from the database, are not synced, and disappear if
                browser data is cleared. Start the backend and reload to
                connect.
              </p>
            </div>
          </div>
        )}
        <div className="workspace">
          <section
            ref={viewerArea}
            className={`viewer-column ${dragging ? "drop-active" : ""}`}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault(); setDragging(false);
              if (busy) return;
              const file = event.dataTransfer.files[0];
              if (file) void openFile(file);
            }}
            aria-label="Scene workspace"
          >
            <div className="scene-heading">
              <div>
                <span className="eyebrow">{scene?.source === "local" ? "LOCAL POINT CLOUD" : "SYNTHETIC COLLECTION"}</span>
                <h2>{scene?.name ?? "Loading scene…"}</h2>
              </div>
              <span className="public-tag">{scene?.source === "local" ? "Local file - not uploaded" : "Public-safe sample"}</span>
            </div>
            <div className="import-bar">
              <input ref={fileInput} type="file" accept=".ply" aria-label="Open PLY file" hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file && !busy) void openFile(file);
                }} />
              <button className="primary" onClick={() => fileInput.current?.click()} disabled={busy}>Open PLY</button>
              <button onClick={() => void restoreSample()} disabled={busy || (!loading && scene?.source === "bundled")}>Use sample</button>
              <span>or drop a file here. {PLY_IMPORT_TEXT}</span>
            </div>
            {warning && <section className="import-warning alert" role="alertdialog" aria-labelledby="import-warning-title" aria-describedby="import-warning-description">
              <h3 id="import-warning-title">{warning.tier === "very-large" ? "Very large PLY" : "Large PLY"} · {warning.filename}</h3>
              <p>{(warning.summary.sizeBytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB · {warning.summary.vertexCount.toLocaleString()} unique vertices</p>
              <p id="import-warning-description">Parsing may use substantially more memory than the file size. Performance depends on your browser, RAM, and GPU.
                {warning.tier === "very-large" && " The tab may become unresponsive or be terminated."}
                {" No downsampling is applied. Your current scene stays visible while loading."}</p>
              <div className="import-actions">
                <button className="primary" onClick={continueImport}>Load full resolution</button>
                <button autoFocus onClick={cancelImport}>Cancel</button>
              </div>
            </section>}
            {loading && !warning && <div className="alert import-progress" role="status">
              <span>{loadStatus.state === "loading" ? loadStatus.message : "Loading PLY…"} {loaded ? "Your current scene stays visible." : ""}</span>
              <button onClick={cancelImport}>Cancel import</button>
            </div>}
            {importError && loaded && <p className="alert error" role="alert">{importError} Your previous scene is unchanged.</p>}
            {!!scene?.face_count && <p className="alert mesh-notice" role="status">Mesh PLY detected. Displaying {scene.point_count.toLocaleString()} unique vertices as a point cloud; {scene.face_count.toLocaleString()} faces are ignored.</p>}
            <div className="viewer-panel panel">
              <div className="toolbar">
                <div className="view-label">
                  <span>◇</span> Point cloud <span className="tag">PLY</span>
                </div>
                <button
                  onClick={() => viewer.current?.reset()}
                  disabled={status.state !== "ready" || selection.busy}
                  title="Return to saved home, or fit the point cloud"
                >
                  ↺ Reset camera
                </button>
              </div>
              <div className="selection-controls">
                <div className="mode-buttons" role="group" aria-label="Navigation and annotation mode">
                  {(["navigate", "point", "rectangle", "lasso"] as const).map((mode) => <button key={mode}
                    aria-pressed={interactionMode === mode} disabled={busy || loading || selection.busy || status.state !== "ready"}
                    onClick={() => {
                      if (mode === "navigate" || mode === "point") cancel();
                      setInteractionMode(mode);
                    }}>{mode === "navigate" ? "Navigate" : mode[0].toUpperCase() + mode.slice(1)}</button>)}
                </div>
                {(interactionMode === "rectangle" || interactionMode === "lasso") && <div className="selection-options">
                  <label>Selection operation <select value={operationMode} onChange={(e) => setOperationMode(e.target.value as SelectionOperationMode)} disabled={selection.busy}>
                    <option value="replace">Replace selection</option><option value="add">Add selection</option><option value="subtract">Subtract selection</option>
                  </select></label>
                  <p>Select through depth · Shift adds · Alt/Option subtracts · Esc cancels drag</p>
                </div>}
                <span className="selected-count" role="status">{selectedGroup ? "Group highlighted" : `${selectedCount.toLocaleString()} ${selectedCount === 1 ? "point" : "points"} selected`}</span>
                {selection.busy && <div className="selection-progress" role="status">
                  <label>Processing selection <progress value={selection.progress} max="1" /></label>
                  <button onClick={selection.abort}>Cancel selection</button>
                </div>}
              </div>
              <OrientationControls viewer={viewer} view={storedView.view} disabled={busy || loading || selection.busy || status.state !== "ready"}
                error={(viewMessage.scene === sceneId ? viewMessage.error : "") || storedView.error}
                notice={(viewMessage.scene === sceneId ? viewMessage.notice : "") || storedView.notice || ""} onSave={saveOrientation} onRestore={restoreOrientation} />
              <PointCloudViewer
                ref={viewer}
                cloud={loaded?.cloud ?? null}
                view={storedView.view}
                interactionMode={interactionMode}
                operationMode={operationMode}
                selectionBusy={selection.busy || busy || loading}
                highlights={highlights}
                onSelectionError={setError}
                onSelection={(operation) => {
                  setError("");
                  void selection.draw(operation, (result) => {
                    setSelectedId(null); setSelectedGroup(null); setNotice("");
                    const bounds = result.result?.bounds;
                    setPosition(bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : null);
                    if (!bounds) setNotice("No points selected. Drag over the cloud to select a region.");
                  });
                }}
                loadStatus={loadStatus}
                onReload={() => void restoreSample()}
                pointSize={pointSize}
                background={background}
                picking={picking && !loading}
                annotations={records}
                selectedId={selectedId}
                selectedGroup={selectedGroup}
                draft={position}
                onPick={pick}
                onSelect={(id) => {
                  const record = records.find((a) => a.id === id);
                  if (record && !busy && !loading && !selection.busy) select(record);
                }}
                onStatus={setRenderStatus}
              />
              <div className="display-controls">
                <div className="point-size-control">
                  <label htmlFor="point-size">Point size</label>
                  <input
                    id="point-size"
                    type="range"
                    min="1"
                    max="8"
                    step="0.5"
                    value={pointSize}
                    onChange={(event) =>
                      setPointSize(Number(event.target.value))
                    }
                  />
                  <output htmlFor="point-size">
                    {pointSize.toFixed(1)} px
                  </output>
                </div>
                <label className="background-control" htmlFor="background">
                  Background{" "}
                  <input
                    id="background"
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="scene-details panel">
              <div className="detail-heading">
                <h3>About this scene</h3>
                <span className="tag">{scene?.source === "local" ? "LOCAL FILE" : "100% SYNTHETIC"}</span>
              </div>
              <p>
                {scene?.description ?? "Preparing a small, public-safe sample."}
              </p>
              <dl className="metadata-grid">
                <div>
                  <dt>Points</dt>
                  <dd>
                    {(status.state === "ready"
                      ? status.count
                      : scene?.point_count
                    )?.toLocaleString() ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{scene?.format ?? "—"}</dd>
                </div>
                <div>
                  <dt>File size</dt>
                  <dd>
                    {scene
                      ? `${(scene.size_bytes / 1024).toFixed(1)} KiB`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Coordinates</dt>
                  <dd>{scene?.coordinates ?? "—"}</dd>
                </div>
                <div><dt>Filename</dt><dd>{scene?.filename ?? "—"}</dd></div>
                <div><dt>Faces (ignored)</dt><dd>{scene?.face_count?.toLocaleString() ?? "—"}</dd></div>
                <div><dt>Point color</dt><dd>{scene ? (scene.color_source === "vertex" ? "Original vertex colors" : "Fallback · sky blue") : "—"}</dd></div>
              </dl>
            </div>
            <div className="navigation-guide">
              <span>
                ⌘ <b>Navigate</b> Drag to orbit · Right-drag to pan · Scroll to
                zoom
              </span>
              <span>
                <b>Touch</b> One finger orbits · Two fingers pan / pinch
              </span>
            </div>
          </section>
          <AnnotationPanel
            records={records}
            region={selection.region}
            position={position}
            selected={selected}
            picking={picking}
            enabled={!!store && !corruption}
            busy={busy || loading || selection.busy}
            canPick={status.state === "ready"}
            error={error}
            notice={notice}
            canRecover={corruption?.sceneId === scene?.id && !!corruption}
            onRecover={async () => {
              if (!corruption || busy || loading || corruption.sceneId !== scene?.id) return;
              setBusy(true);
              try {
                const restored = await recoverLocalStorage(corruption);
                setStore(restored.store); setRecords(restored.records);
                cancel(); setCorruption(null);
                setNotice("Local notes are ready. Other scenes and browser data were kept.");
              } catch (reason) { setError(errorMessage(reason)); }
              finally { setBusy(false); }
            }}
            onNew={() => {
              if (picking) cancel();
              else {
                cancel();
                setPicking(true);
                if (window.innerWidth <= 800)
                  viewerArea.current?.scrollIntoView({ block: "start" });
              }
            }}
            onCancel={cancel}
            onSelect={select}
            selectedGroup={selectedGroup}
            onSelectGroup={(key) => {
              const members = records.filter((a) => groupKey(a.category, a.label) === key);
              void selection.show(members, false, () => {
                setSelectedGroup(key); setSelectedId(null); setPosition(null);
                setInteractionMode("navigate"); setError(""); setNotice("");
              });
            }}
            onSave={save}
            onDelete={remove}
          />
        </div>
        <section className="future-modules" aria-labelledby="future-heading">
          <div className="future-heading">
            <h2 id="future-heading">Future Modules <span>— TBD</span></h2>
            <p>Planned directions. The point-cloud viewer above is the only active module.</p>
          </div>
          <div className="future-grid">
            <article><span className="tag">TBD · PLANNED</span><h3>3D Gaussian Splat Viewer</h3><p>Spark.js visualization</p></article>
            <article><span className="tag">TBD · PLANNED</span><h3>Point Cloud to 3DGS</h3><p>Basic training pipeline</p></article>
            <article><span className="tag">TBD · PLANNED</span><h3>Multiview Reconstruction</h3><p>COLMAP preprocessing/reconstruction</p></article>
          </div>
        </section>
      </main>
      <footer className="app-footer">
        <span>
          NEURAL 3D <span className="footer-divider">/</span> Deep Learning ·
          HW1
        </span>
        <span>Synthetic data. Real exploration.</span>
      </footer>
    </>
  );
}
