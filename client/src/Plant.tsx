import { api, type ApiResponse } from "./api";

export type Project = ApiResponse<typeof api, "listProjects">["projects"][number];

export function Plant({ project, large = false, animate = false }: { project: Project; large?: boolean; animate?: boolean }) {
  const count = project.status === "completed" ? Math.max(15, project.efforts.length) : project.efforts.length;
  const archived = project.status === "archived";
  const blooming = project.status === "completed" || count >= 15;
  const height = count === 0 ? 0 : 30 + Math.min(count, 15) * 7.5;
  const topY = 182 - height;
  const bend = (project.plantVariant % 3 - 1) * 10;
  const leaves = Math.min(count, 11);
  const stemColor = archived ? "var(--dormant)" : "var(--moss)";
  const leafColor = archived ? "var(--dormant-light)" : project.plantVariant % 2 === 0 ? "var(--leaf)" : "var(--leaf-alt)";
  const flowerColor = project.plantVariant % 2 === 0 ? "var(--flower)" : "var(--flower-alt)";

  return (
    <div className={`plant-wrap ${large ? "plant-large" : ""} ${animate ? "is-growing" : ""}`} aria-label={`${project.name}: ${project.growthStage}`}>
      <svg viewBox="0 0 180 220" role="img" aria-hidden="true">
        <ellipse cx="90" cy="193" rx="58" ry="12" fill="var(--soil-soft)" />
        <ellipse cx="90" cy="191" rx="42" ry="7" fill="var(--soil)" opacity=".72" />
        {count === 0 ? (
          <g className="seed-form">
            <path d="M90 190 C75 179 76 166 90 160 C104 166 105 179 90 190Z" fill={archived ? "var(--dormant)" : "var(--seed)"} />
            <path d="M90 161 C91 174 89 182 90 190" stroke="var(--seed-line)" strokeWidth="1.5" fill="none" />
          </g>
        ) : (
          <g>
            <path d={`M90 184 C${88 + bend * 0.4} 145, ${96 + bend} ${topY + 34}, ${90 + bend} ${topY}`} stroke={stemColor} strokeWidth={Math.min(3.5 + count * 0.12, 5.5)} strokeLinecap="round" fill="none" />
            {Array.from({ length: leaves }).map((_, index) => {
              const side = (index + project.plantVariant) % 2 === 0 ? -1 : 1;
              const y = 169 - index * Math.max(8, 80 / Math.max(leaves, 1));
              const x = 92 + bend * ((184 - y) / Math.max(height, 1));
              const size = 9 + ((index + project.plantVariant) % 3) * 2;
              return (
                <g key={index} transform={`translate(${x} ${y}) rotate(${side * (28 + project.plantVariant * 2)})`}>
                  <path d={`M0 0 C${side * size} ${-size}, ${side * size * 2.1} ${-size * .65}, ${side * size * 2.35} 1 C${side * size * 1.2} ${size * .8}, ${side * size * .35} ${size * .4}, 0 0Z`} fill={leafColor} opacity={archived ? .72 : .96} />
                  <path d={`M0 0 L${side * size * 1.8} -1`} stroke="var(--leaf-line)" strokeWidth=".8" opacity=".55" />
                </g>
              );
            })}
            {blooming && !archived && (
              <g transform={`translate(${90 + bend} ${topY - 4})`} className="bloom-group">
                {[0, 72, 144, 216, 288].map((angle) => (
                  <ellipse key={angle} cx="0" cy="-10" rx="7" ry="12" fill={flowerColor} transform={`rotate(${angle})`} />
                ))}
                <circle cx="0" cy="0" r="5.5" fill="var(--pollen)" />
              </g>
            )}
            {project.status === "completed" && !archived && (
              <g opacity=".9">
                <circle cx={69 + bend * .5} cy={topY + 34} r="5" fill={flowerColor} />
                <circle cx={112 + bend * .25} cy={topY + 54} r="4.5" fill={flowerColor} />
              </g>
            )}
          </g>
        )}
        {archived && count > 0 && (
          <g opacity=".55">
            <path d="M56 193 Q68 181 78 193" stroke="var(--dormant)" strokeWidth="1.5" fill="none" />
            <path d="M102 193 Q114 178 127 193" stroke="var(--dormant)" strokeWidth="1.5" fill="none" />
          </g>
        )}
      </svg>
      {project.outcomes.slice(0, 5).map((outcome, index) => (
        <span
          key={outcome.id}
          className={`fruit fruit-${index + 1} ${archived ? "fruit-dormant" : ""}`}
          title={`${outcome.type}: ${outcome.value}`}
          aria-label={`${outcome.type}: ${outcome.value}`}
        />
      ))}
    </div>
  );
}

