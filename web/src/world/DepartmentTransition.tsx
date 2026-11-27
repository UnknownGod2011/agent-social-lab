import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./motion";
const GridScan = lazy(() => import("../vendor/GridScan/GridScan"));

export default function DepartmentTransition({
  name,
  onArrive,
  onFinish,
}: {
  name: string;
  onArrive: () => void;
  onFinish: () => void;
}) {
  const [revealing, setRevealing] = useState(false);
  const [fallback, setFallback] = useState(false);
  const reduced = useReducedMotion();
  const done = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  function arrive() {
    if (done.current) return;
    done.current = true;
    onArrive();
    setRevealing(true);
  }
  useEffect(() => {
    const node = host.current;
    const lost = () => setFallback(true);
    node?.addEventListener("webglcontextlost", lost, true);
    return () => node?.removeEventListener("webglcontextlost", lost, true);
  }, []);
  useEffect(() => {
    if (reduced) {
      arrive();
      onFinish();
    }
  }, [reduced]);
  return (
    <div
      ref={host}
      role="status"
      className={"department-scan scene-scan" + (revealing ? " revealing" : "")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && revealing) onFinish();
      }}
    >
      {fallback ? (
        <i className="scan-fallback" onAnimationEnd={arrive} />
      ) : (
        <Suspense fallback={null}>
          <GridScan
            linesColor="#4d4757"
            scanColor="#7dd3fc"
            cells={8}
            depth={3}
            scanDuration={2.4}
            scanDelay={1.6}
            clickEffect="ping"
            intro={false}
            dpr={1}
            enableWebcam={false}
            enableGyro={false}
            onRenderFailure={() => setFallback(true)}
            onSweepEnd={arrive}
          />
        </Suspense>
      )}
      <span>Opening {name}</span>
    </div>
  );
}
