import "./ModuleGuide.css";

/**
 * <ModuleGuide title="Weighbridge" steps={["...", "..."]} />
 * Renders a plain-language "how this works" panel at the bottom of a
 * module page — for the person operating it, not a developer.
 */
export default function ModuleGuide({ title, steps }) {
  return (
    <div className="module-guide">
      <h4>ℹ️ How {title} works</h4>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
