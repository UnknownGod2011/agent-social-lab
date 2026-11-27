import { lazy, memo, Suspense, useEffect, useState } from "react";
import type { Theme } from "./theme";
import { useReducedMotion } from "./world/motion";
import "./atmosphere.css";

const Aurora = lazy(() => import("./vendor/SoftAurora/SoftAurora.jsx"));
const Splash = lazy(() => import("./vendor/SplashCursor/SplashCursor.jsx"));
const Strands = lazy(() => import("./vendor/Strands/Strands.jsx"));
const pearl = ["#80d7d8", "#b3abdf", "#9ddddd", "#cbb6d4"];
const pearlOnPaper = ["#438d9b", "#8d78ae", "#528f90", "#997e9b"];

export function ProfileOrb({
  theme,
  open,
}: {
  theme: Theme;
  open: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="profile-orb">
      <div className="orb-film" aria-hidden="true">
        {!reduced && (
          <Suspense fallback={null}>
            <Aurora
              speed={0.6}
              scale={1.5}
              brightness={1}
              color1="#f7f7f7"
              color2="#e100ff"
              bandHeight={0.5}
              bandSpread={1}
              enableMouseInteraction
              mouseInfluence={0.25}
              spectrum={1}
              colorSpeed={1}
              noiseFrequency={2.5}
              noiseAmplitude={1}
              tilt={0}
              octaveDecay={0.1}
              layerOffset={0}
              clickPulse
              intro
              lightMode={theme === "light"}
              style={undefined}
            />
          </Suspense>
        )}
      </div>
      <button
        className="orb-button"
        aria-label="About local researcher workspace"
        title="About the research workspace"
        onClick={open}
      >
        R
      </button>
    </div>
  );
}

export const WorkspaceAtmosphere = memo(function WorkspaceAtmosphere({
  theme,
}: {
  theme: Theme;
}) {
  const reduced = useReducedMotion();
  const [finePointer, setFinePointer] = useState(
    () => matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFinePointer(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  if (reduced) return null;
  const paper = theme === "light";
  const colors = paper ? pearlOnPaper : pearl;
  return (
    <>
      <div className="workspace-strands" aria-hidden="true">
        <Suspense fallback={null}>
          <Strands
            colors={colors}
            count={2}
            speed={0.16}
            amplitude={0.55}
            waviness={0.7}
            thickness={0.85}
            spread={0.75}
            glow={0.2}
            glass={false}
            interactive={false}
            clickPulse={false}
            intro={false}
            lightMode={paper}
            maxDevicePixelRatio={0.65}
            level={0}
            style={undefined}
          />
        </Suspense>
      </div>
      {finePointer && (
        <Suspense fallback={null}>
          <Splash
            className="water-trail"
            colors={colors}
            rainbow={false}
            size={0.13}
            force={0.3}
            swirl={1.4}
            trail={0.36}
            clickSplash
            colorSpeed={0.45}
            intensity={0.72}
            momentum={0.33}
            shading={0.65}
            glow={0}
            quality="low"
            intro={false}
            contained={false}
            theme={paper ? "light" : "dark"}
            zIndex={35}
            style={undefined}
          />
        </Suspense>
      )}
    </>
  );
});
