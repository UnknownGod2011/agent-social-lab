import { lazy, memo, Suspense, useState } from "react";
import type { Theme } from "./theme";
import { useReducedMotion } from "./world/motion";
const TechText = lazy(() => import("./vendor/TechText/TechText"));

export default memo(function TechHeading({
  text,
  theme,
}: {
  text: string;
  theme: Theme;
}) {
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
            color={theme === "light" ? "#171717" : "#f2f2ef"}
            accentColor={
              theme === "blue"
                ? "#ffac88"
                : theme === "light"
                  ? "#565656"
                  : "#bbbbbb"
            }
          />
        </Suspense>
      )}
    </h1>
  );
});
