import { useCallback, useEffect, useRef, useState } from "react";
import { parsePly, PlyError } from "./ply";
import { FULL_RESOLUTION_ERROR, sizeWarning } from "./plyPolicy";
import type { WarningTier } from "./plyPolicy";
import type { PlySummary } from "./plyHeader";
import { errorMessage } from "./storage";
import type { LoadedScene, PointCloudData, SceneMetadata, ViewerStatus } from "./types";

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
interface ImportWarning { tier: Exclude<WarningTier, null>; summary: PlySummary; filename: string }

export function useScene(onActivate: () => void, onPrepare: (cloud: PointCloudData) => void) {
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const [loading, setLoading] = useState(true);
  const [importError, setImportError] = useState("");
  const [warning, setWarning] = useState<ImportWarning | null>(null);
  const [loadStatus, setLoadStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading point cloud…" });
  const pending = useRef<AbortController | null>(null);
  const sample = useRef<SceneMetadata | null>(null);
  const decision = useRef<((accepted: boolean) => void) | null>(null);

  const cancelImport = useCallback(() => {
    pending.current?.abort();
    decision.current?.(false);
    decision.current = null;
    setWarning(null);
    setLoading(false);
    setLoadStatus({ state: "empty", message: "Import cancelled. Open a PLY file or reload the sample." });
  }, []);

  const load = useCallback(async (file?: File) => {
    pending.current?.abort();
    decision.current?.(false);
    decision.current = null;
    setWarning(null);
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setImportError("");
    setLoadStatus({ state: "loading", message: "Inspecting PLY header…" });
    try {
      let metadata: SceneMetadata;
      let blob: Blob;
      if (file) {
        if (!/\.ply$/i.test(file.name)) throw new PlyError("Only .ply files are supported. Choose a PLY file.");
        if (file.name.length > 255 || (/[\\/]/.test(file.name) || [...file.name].some((c) => c.charCodeAt(0) < 32))) throw new PlyError("Choose a PLY filename of at most 255 characters without directory or control characters.");
        blob = file;
      } else {
        if (!sample.current) {
          const response = await fetch(assetUrl("data/scene.json"), { signal: controller.signal });
          if (!response.ok) throw new Error(`Scene metadata unavailable (HTTP ${response.status}).`);
          const data: SceneMetadata = await response.json();
          if (!data.asset || data.id !== "spectrum-garden" || !data.sha256) throw new Error("Invalid sample metadata.");
          sample.current = data;
        }
        const response = await fetch(assetUrl(sample.current.asset), { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load the PLY (HTTP ${response.status}).`);
        blob = await response.blob();
      }
      if (controller.signal.aborted) return;
      const cloud = await parsePly(blob, controller.signal, async (summary) => {
        const tier = sizeWarning(summary.sizeBytes, summary.vertexCount);
        if (!tier) return true;
        setWarning({ tier, summary, filename: file?.name ?? "Spectrum Garden" });
        return new Promise<boolean>((resolve) => { decision.current = resolve; });
      }, (message) => {
        if (!controller.signal.aborted) setLoadStatus({ state: "loading", message });
      });
      if (controller.signal.aborted) return;
      if (file) {
        const vector = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z].map((n) => Number(n.toPrecision(6))).join(", ");
        metadata = {
          id: cloud.sha256 === sample.current?.sha256 ? "spectrum-garden" : `ply-${cloud.sha256}`,
          name: file.name.replace(/\.ply$/i, "") || file.name, filename: file.name, source: "local", asset: "",
          description: "Opened from your device. PLY bytes stay in this browser session. Only scene metadata and annotations may be saved to the connected database.",
          format: cloud.format, sha256: cloud.sha256, point_count: cloud.positions.length / 3, size_bytes: file.size,
          coordinates: `Native file coordinates · adjustable view orientation · units unspecified. Bounds [${vector(cloud.bounds.min)}] → [${vector(cloud.bounds.max)}]`,
        };
      } else {
        metadata = { ...sample.current!, source: "bundled", filename: sample.current!.asset.split("/").pop() };
        if (cloud.sha256 !== metadata.sha256) throw new PlyError("The sample checksum does not match its metadata. Restore the bundled sample and retry.");
      }
      metadata.face_count = cloud.face_count;
      metadata.color_source = cloud.color_source;
      // Upload replacement buffers successfully before changing the active scene
      // or its annotation store. A failed allocation leaves the old view intact.
      try { onPrepare(cloud); } catch { throw new PlyError(FULL_RESOLUTION_ERROR); }
      onActivate();
      setLoaded({ metadata, cloud });
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        const message = error instanceof RangeError ? FULL_RESOLUTION_ERROR : errorMessage(error);
        setImportError(message);
        setLoadStatus({ state: error instanceof PlyError && error.empty ? "empty" : "error", message });
      }
    } finally {
      if (pending.current === controller) {
        setLoading(false);
        setWarning(null);
        decision.current = null;
      }
    }
  }, [onActivate, onPrepare]);

  useEffect(() => {
    void load();
    return () => { pending.current?.abort(); pending.current = null; decision.current?.(false); decision.current = null; };
  }, [load]);
  const continueImport = () => { setWarning(null); decision.current?.(true); decision.current = null; };
  return { loaded, loading, importError, loadStatus, warning, continueImport, cancelImport,
    openFile: (file: File) => load(file), restoreSample: () => load() };
}
