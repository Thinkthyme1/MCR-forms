export function buildFileName(formType, general) {
  const d = new Date();
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  const yy = String(d.getFullYear()).slice(-2);
  const a = (general.firstName || "X")[0]?.toUpperCase() || "X";
  const b = (general.lastName || "X")[0]?.toUpperCase() || "X";
  return `${a}${b} ${m}.${day}.${yy} ${formType}.pdf`;
}
