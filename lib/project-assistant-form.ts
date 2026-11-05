export type AgentFormFieldType = "text" | "email" | "password" | "number" | "textarea" | "select" | "checkbox";

export type AgentFormField = {
  key: string;
  label: string;
  type: AgentFormFieldType;
  placeholder?: string;
  required?: boolean;
  help?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
};

export type AgentForm = {
  id: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: AgentFormField[];
  /** Pre-filled values sent with the form but not shown as inputs. */
  hidden?: Record<string, string>;
};

const FORM_FENCE = /```agent-form\s*([\s\S]*?)```/i;

export function parseAgentForm(content: string): {
  markdown: string;
  form: AgentForm | null;
} {
  const match = content.match(FORM_FENCE);
  if (!match) {
    return { markdown: content, form: null };
  }
  try {
    const parsed = JSON.parse(match[1].trim()) as AgentForm;
    if (!parsed || !Array.isArray(parsed.fields) || !parsed.title) {
      return { markdown: content.replace(FORM_FENCE, "").trim(), form: null };
    }
    const form: AgentForm = {
      id: String(parsed.id || `form-${Date.now()}`),
      title: String(parsed.title),
      description: parsed.description ? String(parsed.description) : undefined,
      submitLabel: parsed.submitLabel ? String(parsed.submitLabel) : "Continue",
      fields: parsed.fields
        .filter((field) => field && field.key && field.label)
        .map((field) => ({
          key: String(field.key),
          label: String(field.label),
          type: (field.type as AgentFormFieldType) || "text",
          placeholder: field.placeholder ? String(field.placeholder) : undefined,
          required: Boolean(field.required),
          help: field.help ? String(field.help) : undefined,
          defaultValue: field.defaultValue,
          options: Array.isArray(field.options)
            ? field.options.map((option) => ({
                value: String(option.value),
                label: String(option.label),
              }))
            : undefined,
        })),
      hidden:
        parsed.hidden && typeof parsed.hidden === "object"
          ? Object.fromEntries(
              Object.entries(parsed.hidden).map(([key, value]) => [
                key,
                String(value ?? ""),
              ]),
            )
          : undefined,
    };
    return {
      markdown: content.replace(FORM_FENCE, "").trim(),
      form: form.fields.length ? form : null,
    };
  } catch {
    return { markdown: content.replace(FORM_FENCE, "").trim(), form: null };
  }
}

export function serializeAgentForm(form: AgentForm) {
  return `\n\n\`\`\`agent-form\n${JSON.stringify(form)}\n\`\`\``;
}

export function formatFormSubmission(
  form: AgentForm,
  values: Record<string, string | boolean>,
) {
  const lines = [
    `Submitted “${form.title}”. Use these values with the matching tool (do not ask again):`,
  ];
  for (const field of form.fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === "") continue;
    if (field.type === "checkbox") {
      lines.push(
        `- ${field.key}: ${raw === true || raw === "true" ? "true" : "false"} (${field.label})`,
      );
      continue;
    }
    lines.push(`- ${field.key}: ${String(raw)} (${field.label})`);
  }
  if (form.hidden) {
    for (const [key, value] of Object.entries(form.hidden)) {
      if (!value) continue;
      lines.push(`- ${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

export function normalizePresentFormArgs(args: Record<string, unknown>): AgentForm | null {
  const title = String(args.title || "").trim();
  const fieldsRaw = Array.isArray(args.fields) ? args.fields : [];
  if (!title || fieldsRaw.length === 0) return null;

  const fields: AgentFormField[] = [];
  for (const item of fieldsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = String(row.key || "").trim();
    const label = String(row.label || "").trim();
    if (!key || !label) continue;
    const type = String(row.type || "text") as AgentFormFieldType;
    fields.push({
      key,
      label,
      type: [
        "text",
        "email",
        "password",
        "number",
        "textarea",
        "select",
        "checkbox",
      ].includes(type)
        ? type
        : "text",
      placeholder: row.placeholder ? String(row.placeholder) : undefined,
      required: Boolean(row.required),
      help: row.help ? String(row.help) : undefined,
      defaultValue:
        row.defaultValue === undefined
          ? undefined
          : (row.defaultValue as string | number | boolean),
      options: Array.isArray(row.options)
        ? row.options
            .filter((option) => option && typeof option === "object")
            .map((option) => {
              const opt = option as Record<string, unknown>;
              return {
                value: String(opt.value ?? ""),
                label: String(opt.label ?? opt.value ?? ""),
              };
            })
            .filter((option) => option.value)
        : undefined,
    });
  }
  if (!fields.length) return null;

  const hiddenRaw =
    args.hidden && typeof args.hidden === "object" && !Array.isArray(args.hidden)
      ? (args.hidden as Record<string, unknown>)
      : undefined;

  return {
    id: String(args.id || `form-${Date.now().toString(36)}`),
    title,
    description: args.description ? String(args.description) : undefined,
    submitLabel: args.submit_label
      ? String(args.submit_label)
      : args.submitLabel
        ? String(args.submitLabel)
        : "Continue",
    fields,
    hidden: hiddenRaw
      ? Object.fromEntries(
          Object.entries(hiddenRaw).map(([key, value]) => [key, String(value ?? "")]),
        )
      : undefined,
  };
}
