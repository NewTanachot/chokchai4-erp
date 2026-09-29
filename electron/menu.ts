import { app, Menu, type MenuItemConstructorOptions } from "electron";
import { tr } from "./i18n";

/** Application menu in the current language (rebuilt when it changes). */
export function buildAppMenu(isDev: boolean): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about", label: tr("เกี่ยวกับโปรแกรม") },
              { type: "separator" },
              { role: "hide", label: tr("ซ่อน") },
              { role: "hideOthers", label: tr("ซ่อนแอปอื่น") },
              { role: "unhide", label: tr("แสดงทั้งหมด") },
              { type: "separator" },
              { role: "quit", label: tr("ออกจากโปรแกรม") },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : [{ label: tr("ไฟล์"), submenu: [{ role: "quit", label: tr("ออกจากโปรแกรม") }] } satisfies MenuItemConstructorOptions]),
    {
      label: tr("แก้ไข"),
      submenu: [
        { role: "undo", label: tr("เลิกทำ") },
        { role: "redo", label: tr("ทำซ้ำ") },
        { type: "separator" },
        { role: "cut", label: tr("ตัด") },
        { role: "copy", label: tr("คัดลอก") },
        { role: "paste", label: tr("วาง") },
        { role: "selectAll", label: tr("เลือกทั้งหมด") },
      ],
    },
    {
      label: tr("มุมมอง"),
      submenu: [
        { role: "reload", label: tr("โหลดใหม่") },
        ...(isDev ? ([{ role: "toggleDevTools" }] as MenuItemConstructorOptions[]) : []),
        { type: "separator" },
        { role: "resetZoom", label: tr("ขนาดปกติ") },
        { role: "zoomIn", label: tr("ขยาย") },
        { role: "zoomOut", label: tr("ย่อ") },
        { type: "separator" },
        { role: "togglefullscreen", label: tr("เต็มจอ") },
      ],
    },
    { label: tr("หน้าต่าง"), submenu: [{ role: "minimize", label: tr("ย่อหน้าต่าง") }, { role: "close", label: tr("ปิดหน้าต่าง") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
