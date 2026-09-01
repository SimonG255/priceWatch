import writeXlsxFile from "write-excel-file/node";

const headerStyle = { type: String, fontWeight: "bold", color: "#FFFFFF", backgroundColor: "#123F37" };
const rows = [
  ["Product Name", "EAN", "SKU", "Notes", "Your Price"].map(value => ({ value, ...headerStyle })),
  [
    { value: "Example product (delete this row)", type: String },
    { value: "5099206123456", type: String },
    { value: "", type: String },
    { value: "", type: String },
    { value: "", type: Number },
  ],
];

await writeXlsxFile(rows, {
  filePath: new URL("../public/nexus-product-import-template.xlsx", import.meta.url),
  sheet: "Products",
  columns: [{ width: 42 }, { width: 20 }, { width: 20 }, { width: 30 }, { width: 14 }],
});
