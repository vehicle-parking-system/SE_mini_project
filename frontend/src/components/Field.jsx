// Labelled input with an inline error message from the API's per-field details.
export default function Field({ label, error, hint, ...input }) {
  const id = input.id || input.name;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...input} />
      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
