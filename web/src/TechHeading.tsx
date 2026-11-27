import { lazy, memo, Suspense, useState } from "react";
import { useReducedMotion } from "./world/motion";
const TechText = lazy(() => import("./vendor/TechText/TechText"));

export default memo(function TechHeading({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [canvas] = useState(
    () => !!document.createElement("canvas").getContext("2d"),
  );
  const plain = (
    <>
      {text}
      <i className="heading-period">.</i>
    </>
  );
  return (
    <h1 className="tech-heading" aria-label={text}>
      {reduced || !canvas ? (
        plain
      ) : (
        <Suspense fallback={plain}>
          <span aria-hidden="true" className="heading-measure">
            {text}.
          </span>
          <TechText
            text={text + "."}
            fontFamily="Bricolage"
            fontWeight={600}
            fontSize={150}
            reveal="letter"
            align="left"
            dashLength={4}
            dashGap={2}
            specks={15}
            intro="none"
            introDuration={2}
            clickKick
            guides={false}
            labels={false}
            draggable={false}
            selection={false}
            color="#f2f2ef"
            accentColor="#ffac88"
          />
        </Suspense>
      )}
    </h1>
  );
});
