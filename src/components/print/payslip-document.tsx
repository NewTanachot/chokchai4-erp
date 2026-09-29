/**
 * Printed payslip (สลิปเงินเดือน) for the /print/payslip/ route: a thermal-roll layout and an A4 / A5 layout,
 * styled with the receipt stylesheet (print-styles.ts) plus PAYSLIP_CSS.
 */
import { amountInWords } from "@shared/bahttext";
import { PAY_METHOD_LABELS, PAY_TYPE_LABELS, type AppSettings, type PaperSize, type Payslip, type PayslipItem } from "@shared/contract";
import { formatMoney, formatQty } from "@shared/money";
import { parseDateStr } from "@shared/dates";
import { payRateText } from "@/components/employees/employee-utils";
import { LOCALE, lang, tr } from "@/lib/i18n";
import { isThermal } from "./doc-model";

export const PAYSLIP_CSS = /* css */ `
.pd-ps-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 4mm; }
.pd-ps-table { width: 100%; border-collapse: collapse; }
.pd-ps-table th { text-align: left; font-weight: 700; border-bottom: 1.5px solid #111; padding: 1.2mm 2mm; }
.pd-ps-table th:last-child, .pd-ps-table td:last-child { text-align: right; }
.pd-ps-table td { padding: 1.1mm 2mm; border-bottom: 1px solid #d6d6d6; vertical-align: top; }
.pd-ps-table tfoot td { font-weight: 700; border-bottom: 0; border-top: 1.5px solid #111; }
.pd-ps-sub { font-size: .86em; color: #555; }
.pd-ps-net { margin-top: 4mm; display: flex; justify-content: space-between; align-items: center; border: 1.5px solid #111; border-radius: 1.8mm; padding: 2.5mm 4mm; }
.pd-ps-net b { font-size: 1.5em; }
.pd-ps-stats { margin-top: 3mm; color: #333; }
`;

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const d = (s: string) => dateFmt.format(parseDateStr(s));
const dt = (ms: number) => tr("{0} {1} น.", dateFmt.format(ms), new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" }).format(ms));

function statsLine(p: Payslip): string {
  const s = p.stats;
  const parts = [tr("มาทำงาน {0}/{1} วัน", formatQty(s.daysWorked), s.workDays)];
  if (s.lateCount) parts.push(tr("สาย {0} ครั้ง ({1} นาที)", s.lateCount, s.lateMinutes));
  if (s.absentDays) parts.push(tr("ขาด {0} วัน", formatQty(s.absentDays)));
  if (s.paidLeaveDays + s.unpaidLeaveDays) parts.push(tr("ลา {0} วัน", formatQty(s.paidLeaveDays + s.unpaidLeaveDays)));
  if (s.otMinutes) parts.push(tr("OT {0} ชม. {1} นาที", Math.floor(s.otMinutes / 60), s.otMinutes % 60));
  return parts.join(" · ");
}

const qtyText = (i: PayslipItem) => (i.qty !== null && i.rate !== null ? `${formatQty(i.qty)} × ${formatMoney(Math.round(i.rate))}` : null);

export function PayslipDocument({ payslip: p, settings, paper }: { payslip: Payslip; settings: AppSettings; paper: PaperSize }) {
  const logoSrc = settings.print.showLogo ? settings.shop.logoDataUrl || "/logo.png" : null;
  const earnings = p.items.filter((i) => i.kind === "earning");
  const deductions = p.items.filter((i) => i.kind === "deduction");
  const s = settings.shop;

  if (isThermal(paper)) {
    return (
      <div className={`pd-thermal pd-paper pd-${paper}`} data-print-sheet>
        <header className="pd-t-head">
          {logoSrc && <img className="pd-t-logo" src={logoSrc} alt="" />}
          <div className="pd-t-shop">{s.name}</div>
          {s.branch && <div className="pd-t-sub">{s.branch}</div>}
        </header>
        <hr className="pd-sep" />
        <div className="pd-t-title">{tr("สลิปเงินเดือน")}</div>
        <div className="pd-kv">
          <span>{tr("งวด")}</span>
          <span>{p.runTitle}</span>
        </div>
        <div className="pd-kv">
          <span>{tr("ช่วงวันที่")}</span>
          <span>
            {d(p.periodStart)} – {d(p.periodEnd)}
          </span>
        </div>
        <div className="pd-kv">
          <span>{tr("พนักงาน")}</span>
          <b>{p.employeeName}</b>
        </div>
        {p.position && (
          <div className="pd-kv">
            <span>{tr("ตำแหน่ง")}</span>
            <span>{p.position}</span>
          </div>
        )}
        <div className="pd-kv">
          <span>{PAY_TYPE_LABELS[p.payType]}</span>
          <span className="pd-num">{payRateText(p.payType, p.payRate)}</span>
        </div>
        <hr className="pd-sep" />
        <div className="pd-t-colhead">
          <span>{tr("รายได้")}</span>
          <span>{tr("จำนวนเงิน")}</span>
        </div>
        {earnings.map((i, n) => (
          <div className="pd-t-calc" key={`e${n}`} style={{ paddingLeft: 0 }}>
            <span>
              {tr(i.label)}
              {qtyText(i) && <span className="pd-ps-sub"> ({qtyText(i)})</span>}
            </span>
            <span className="pd-num">{formatMoney(i.amount)}</span>
          </div>
        ))}
        <div className="pd-kv pd-b">
          <span>{tr("รวมรายได้")}</span>
          <span className="pd-num">{formatMoney(p.earnings)}</span>
        </div>
        {deductions.length > 0 && (
          <>
            <hr className="pd-sep" />
            <div className="pd-t-colhead">
              <span>{tr("รายการหัก")}</span>
              <span>{tr("จำนวนเงิน")}</span>
            </div>
            {deductions.map((i, n) => (
              <div className="pd-t-calc" key={`d${n}`} style={{ paddingLeft: 0 }}>
                <span>
                  {tr(i.label)}
                  {qtyText(i) && <span className="pd-ps-sub"> ({qtyText(i)})</span>}
                </span>
                <span className="pd-num">-{formatMoney(i.amount)}</span>
              </div>
            ))}
            <div className="pd-kv pd-b">
              <span>{tr("รวมรายการหัก")}</span>
              <span className="pd-num">-{formatMoney(p.deductions)}</span>
            </div>
          </>
        )}
        <div className="pd-t-grand">
          <span>{tr("รับสุทธิ")}</span>
          <span className="pd-num">฿{formatMoney(p.net)}</span>
        </div>
        <div className="pd-ps-sub" style={{ marginTop: "1.5mm" }}>
          {statsLine(p)}
        </div>
        {p.status === "paid" && p.paidAt ? (
          <div className="pd-kv" style={{ marginTop: "1.5mm" }}>
            <span>{tr("จ่ายเมื่อ")}</span>
            <span>
              {dt(p.paidAt)} {p.paymentMethod ? `(${PAY_METHOD_LABELS[p.paymentMethod]})` : ""}
            </span>
          </div>
        ) : null}
        {p.note && <div className="pd-t-note">{tr("หมายเหตุ: {0}", p.note)}</div>}
        <div style={{ marginTop: "9mm", display: "flex", gap: "2mm", alignItems: "flex-end" }}>
          <span>{tr("ลงชื่อผู้รับเงิน")}</span>
          <span className="pd-s-dots" />
        </div>
      </div>
    );
  }

  return (
    <div className={`pd-sheet pd-paper pd-${paper}`} data-print-sheet>
      <header className="pd-s-head">
        <div className="pd-s-shop">
          {logoSrc && <img className="pd-s-logo" src={logoSrc} alt="" />}
          <div>
            <div className="pd-s-shopname">{s.name}</div>
            <div className="pd-s-shopinfo">
              {s.branch && <div>{s.branch}</div>}
              {s.address && <div className="pd-pre">{s.address}</div>}
              {s.phone && <div>{tr("โทร {0}", s.phone)}</div>}
            </div>
          </div>
        </div>
        <div className="pd-s-doc">
          <div className="pd-s-title">{tr("สลิปเงินเดือน")}</div>
          <table className="pd-s-meta">
            <tbody>
              <tr>
                <th>{tr("งวด")}</th>
                <td>{p.runTitle}</td>
              </tr>
              <tr>
                <th>{tr("ช่วงวันที่")}</th>
                <td>
                  {d(p.periodStart)} – {d(p.periodEnd)}
                </td>
              </tr>
              {p.status === "paid" && p.paidAt ? (
                <tr>
                  <th>{tr("วันที่จ่าย")}</th>
                  <td>{dateFmt.format(p.paidAt)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </header>

      <section className="pd-s-parties">
        <div className="pd-s-box">
          <div className="pd-s-label">{tr("พนักงาน")}</div>
          <div className="pd-s-partyname">{p.employeeName}</div>
          <dl className="pd-s-dl">
            {p.position && (
              <>
                <dt>{tr("ตำแหน่ง")}</dt>
                <dd>{p.position}</dd>
              </>
            )}
            <dt>{PAY_TYPE_LABELS[p.payType]}</dt>
            <dd>{payRateText(p.payType, p.payRate)}</dd>
          </dl>
        </div>
        <div className="pd-s-box">
          <div className="pd-s-label">{tr("การจ่ายเงิน")}</div>
          <dl className="pd-s-dl">
            <dt>{tr("สถานะ")}</dt>
            <dd>{p.status === "paid" ? tr("จ่ายแล้ว") : tr("ยังไม่จ่าย")}</dd>
            {p.paymentMethod && (
              <>
                <dt>{tr("จ่ายโดย")}</dt>
                <dd>{PAY_METHOD_LABELS[p.paymentMethod]}</dd>
              </>
            )}
            {p.bankAccount && (
              <>
                <dt>{tr("บัญชี")}</dt>
                <dd>
                  {p.bankName ?? ""} {p.bankAccount}
                </dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section className="pd-ps-cols">
        <table className="pd-ps-table">
          <thead>
            <tr>
              <th>{tr("รายได้")}</th>
              <th>{tr("จำนวนเงิน")}</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((i, n) => (
              <tr key={n}>
                <td>
                  {tr(i.label)}
                  {qtyText(i) && <div className="pd-ps-sub">{qtyText(i)}</div>}
                </td>
                <td className="pd-num">{formatMoney(i.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{tr("รวมรายได้")}</td>
              <td className="pd-num">{formatMoney(p.earnings)}</td>
            </tr>
          </tfoot>
        </table>
        <table className="pd-ps-table">
          <thead>
            <tr>
              <th>{tr("รายการหัก")}</th>
              <th>{tr("จำนวนเงิน")}</th>
            </tr>
          </thead>
          <tbody>
            {deductions.length ? (
              deductions.map((i, n) => (
                <tr key={n}>
                  <td>
                    {tr(i.label)}
                    {qtyText(i) && <div className="pd-ps-sub">{qtyText(i)}</div>}
                  </td>
                  <td className="pd-num">{formatMoney(i.amount)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>-</td>
                <td className="pd-num">0.00</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>{tr("รวมรายการหัก")}</td>
              <td className="pd-num">{formatMoney(p.deductions)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="pd-ps-net">
        <span>
          {tr("รับสุทธิ")}
          {p.net > 0 && <span className="pd-ps-sub"> ({amountInWords(p.net, lang)})</span>}
        </span>
        <b className="pd-num">฿{formatMoney(p.net)}</b>
      </div>
      <div className="pd-ps-stats">{statsLine(p)}</div>
      {p.note && (
        <div className="pd-s-note">
          <b>{tr("หมายเหตุ:")}</b> {p.note}
        </div>
      )}

      <section className="pd-s-signs">
        {[tr("ผู้จ่ายเงิน"), tr("ผู้รับเงิน")].map((label) => (
          <div className="pd-s-sign" key={label}>
            <div className="pd-s-signrow">
              <span>{tr("ลงชื่อ")}</span>
              <span className="pd-s-dots" />
            </div>
            <div className="pd-s-signrow pd-s-signname">
              <span>(</span>
              <span className="pd-s-dots" />
              <span>)</span>
            </div>
            <div className="pd-b">{label}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
