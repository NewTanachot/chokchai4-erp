/**
 * Printed document templates. Rendered by the /print route (hidden print window, PDF export,
 * preview iframe). Styling lives in print-styles.ts (black on white, independent of the app theme).
 */
import { formatMoney, formatQty } from "@shared/money";
import { LOCALE, tr } from "@/lib/i18n";
import { formatRate, type DocModel } from "./doc-model";

const dateShort = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const dateLong = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" });
const time = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });

/** "25 ก.ย. 2569 14:05 น." (Buddhist era) */
export const printDateTime = (ms: number) => tr("{0} {1} น.", dateShort.format(ms), time.format(ms));
const printDateLong = (ms: number) => dateLong.format(ms);
const printTime = (ms: number) => tr("{0} น.", time.format(ms));
const km = (n: number) => tr("{0} กม.", new Intl.NumberFormat(LOCALE).format(n));
const neg = (satang: number) => `-${formatMoney(satang)}`;

export function PrintDocument({ model }: { model: DocModel }) {
  return model.thermal ? <ThermalReceipt m={model} /> : <SheetDocument m={model} />;
}

function VoidMark() {
  return (
    <div className="pd-void-mark" aria-hidden>
      <span>{tr("ยกเลิก")}</span>
    </div>
  );
}

function Kv({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`pd-kv ${className ?? ""}`}>
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------- thermal

function ThermalReceipt({ m }: { m: DocModel }) {
  const s = m.shop;
  const p = m.party;
  const showSubtotal = m.discount > 0 || m.vatMode === "exclusive" || m.subtotal !== m.total;
  const showNet = m.vatMode === "exclusive" && m.discount > 0;
  return (
    <div className={`pd-thermal pd-paper pd-${m.paper}`} data-print-sheet>
      {m.void && <VoidMark />}
      <header className="pd-t-head">
        {m.logoSrc && <img className="pd-t-logo" src={m.logoSrc} alt="" />}
        <div className="pd-t-shop">{s.name}</div>
        {s.branch && <div className="pd-t-sub">{s.branch}</div>}
        {s.address && <div className="pd-t-sub pd-pre">{s.address}</div>}
        {s.phone && <div className="pd-t-sub">{tr("โทร {0}", s.phone)}</div>}
        {s.lineId && <div className="pd-t-sub">LINE {s.lineId}</div>}
        {s.taxId && <div className="pd-t-sub">{tr("เลขประจำตัวผู้เสียภาษี {0}", s.taxId)}</div>}
      </header>
      <hr className="pd-sep" />
      <div className="pd-t-title">{m.title}</div>
      {m.void && (
        <div className="pd-t-flag">
          {tr("เอกสารนี้ถูกยกเลิก")}
          {m.void.reason && <small>{m.void.reason}</small>}
        </div>
      )}
      <Kv label={tr("เลขที่")}>
        <b>{m.docNo}</b>
      </Kv>
      <Kv label={tr("วันที่")}>{printDateTime(m.occurredAt)}</Kv>
      {m.staffName && <Kv label={tr("ผู้ออกบิล")}>{m.staffName}</Kv>}
      {p.name && <Kv label={p.label}>{p.name}</Kv>}
      {p.shopName && <Kv label={tr("ร้าน/บริษัท")}>{p.shopName}</Kv>}
      {p.phone && <Kv label={tr("โทร")}>{p.phone}</Kv>}
      {m.isTaxInvoice && p.taxId && <Kv label={tr("เลขผู้เสียภาษี")}>{p.taxId}</Kv>}
      {m.vehicle?.plate && <Kv label={tr("ทะเบียน")}>{m.vehicle.plate}</Kv>}
      {m.vehicle?.model && <Kv label={tr("รุ่นรถ")}>{m.vehicle.model}</Kv>}
      {m.vehicle?.mileage ? <Kv label={tr("เลขไมล์")}>{km(m.vehicle.mileage)}</Kv> : null}
      <hr className="pd-sep" />
      <div className="pd-t-colhead">
        <span>{tr("รายการ ({0})", m.lines.length)}</span>
        <span>{tr("จำนวนเงิน")}</span>
      </div>
      {m.lines.map((l) => (
        <div className="pd-t-item" key={l.no}>
          <div className="pd-t-item-name">{l.name}</div>
          {l.note && <div className="pd-t-item-note">{l.note}</div>}
          <div className="pd-t-calc">
            <span className="pd-num">
              {formatQty(l.qty)}
              {l.unit ? ` ${l.unit}` : ""} × {formatMoney(l.unitPrice)}
            </span>
            <span className="pd-num">{formatMoney(l.total + l.discount)}</span>
          </div>
          {l.discount > 0 && (
            <div className="pd-t-calc">
              <span>{tr("ส่วนลด")}</span>
              <span className="pd-num">{neg(l.discount)}</span>
            </div>
          )}
        </div>
      ))}
      {showSubtotal ? <hr className="pd-sep" /> : <div style={{ height: "1.2mm" }} />}
      {showSubtotal && (
        <Kv label={tr("รวมเป็นเงิน")}>
          <span className="pd-num">{formatMoney(m.subtotal)}</span>
        </Kv>
      )}
      {m.discount > 0 && (
        <Kv label={tr("ส่วนลด")}>
          <span className="pd-num">{neg(m.discount)}</span>
        </Kv>
      )}
      {m.vatMode === "exclusive" && (
        <>
          {showNet && (
            <Kv label={tr("มูลค่าก่อนภาษี")}>
              <span className="pd-num">{formatMoney(m.beforeVat)}</span>
            </Kv>
          )}
          <Kv label={tr("ภาษีมูลค่าเพิ่ม {0}%", formatRate(m.vatRate))}>
            <span className="pd-num">{formatMoney(m.vatAmount)}</span>
          </Kv>
        </>
      )}
      <div className="pd-t-grand">
        <span>{tr("ยอดสุทธิ")}</span>
        <span className="pd-num">฿{formatMoney(m.total)}</span>
      </div>
      {m.vatMode === "inclusive" && (
        <>
          <div className="pd-t-vatnote">{tr("ราคารวม VAT แล้ว")}</div>
          <Kv label={tr("มูลค่าก่อนภาษี")}>
            <span className="pd-num">{formatMoney(m.beforeVat)}</span>
          </Kv>
          <Kv label={tr("ภาษีมูลค่าเพิ่ม {0}%", formatRate(m.vatRate))}>
            <span className="pd-num">{formatMoney(m.vatAmount)}</span>
          </Kv>
          <hr className="pd-sep" />
        </>
      )}
      <Kv label={tr("ชำระโดย")}>{m.paymentMethod}</Kv>
      {!m.unpaid && <Kv label={tr("สถานะ")}>{tr("ชำระแล้ว")}</Kv>}
      {m.unpaid && !m.void && (
        <div className="pd-t-flag">
          {tr("ค้างชำระ ฿{0}", formatMoney(m.total))}
          <small>{m.kind === "purchase" ? tr("ยังไม่ได้จ่ายเงินผู้ขาย") : tr("ยังไม่ได้รับชำระเงิน")}</small>
        </div>
      )}
      {m.note && <div className="pd-t-note">{tr("หมายเหตุ: {0}", m.note)}</div>}
      {m.footer && (
        <>
          <hr className="pd-sep" />
          <div className="pd-t-foot">{m.footer}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- A4 / A5

function SheetDocument({ m }: { m: DocModel }) {
  const s = m.shop;
  const p = m.party;
  const contact = [s.phone && tr("โทร {0}", s.phone), s.lineId && `LINE ${s.lineId}`].filter((v): v is string => !!v);
  const showVehicle = !!m.vehicle && m.kind !== "purchase";
  return (
    <div className={`pd-sheet pd-paper pd-${m.paper}`} data-print-sheet>
      {m.void && <VoidMark />}
      <header className="pd-s-head">
        <div className="pd-s-shop">
          {m.logoSrc && <img className="pd-s-logo" src={m.logoSrc} alt="" />}
          <div>
            <div className="pd-s-shopname">{s.name}</div>
            <div className="pd-s-shopinfo">
              {s.branch && <div>{s.branch}</div>}
              {s.address && <div className="pd-pre">{s.address}</div>}
              {contact.length > 0 && (
                <div className="pd-s-contact">
                  {contact.map((c, i) => (
                    <span key={c}>
                      {i > 0 && <span className="pd-dot"> · </span>}
                      <span className="pd-nowrap">{c}</span>
                    </span>
                  ))}
                </div>
              )}
              {s.taxId && <div>{tr("เลขประจำตัวผู้เสียภาษี {0}", s.taxId)}</div>}
            </div>
          </div>
        </div>
        <div className="pd-s-doc">
          <div className="pd-s-title">{m.title}</div>
          <table className="pd-s-meta">
            <tbody>
              <tr>
                <th>{tr("เลขที่")}</th>
                <td>{m.docNo}</td>
              </tr>
              <tr>
                <th>{tr("วันที่")}</th>
                <td>{printDateLong(m.occurredAt)}</td>
              </tr>
              <tr>
                <th>{tr("เวลา")}</th>
                <td>{printTime(m.occurredAt)}</td>
              </tr>
              {m.staffName && (
                <tr>
                  <th>{tr("ผู้ออกบิล")}</th>
                  <td>{m.staffName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </header>

      {m.void && (
        <div className="pd-s-voidbar">
          {tr("เอกสารนี้ถูกยกเลิกแล้ว")}
          <span>
            {m.void.at ? tr(" เมื่อ {0}", printDateTime(m.void.at)) : ""}
            {m.void.reason ? tr(" · เหตุผล: {0}", m.void.reason) : ""}
          </span>
        </div>
      )}

      <section className="pd-s-parties">
        <div className="pd-s-box">
          <div className="pd-s-label">{p.label}</div>
          <div className="pd-s-partyname">{p.name ?? (m.kind === "purchase" ? "-" : tr("ลูกค้าทั่วไป"))}</div>
          {(p.shopName || p.address || p.taxId || p.phone) && (
            <dl className="pd-s-dl">
              {p.shopName && (
                <>
                  <dt>{tr("ร้าน/บริษัท")}</dt>
                  <dd>{p.shopName}</dd>
                </>
              )}
              {p.address && (
                <>
                  <dt>{tr("ที่อยู่")}</dt>
                  <dd className="pd-pre">{p.address}</dd>
                </>
              )}
              {p.taxId && (
                <>
                  <dt>{tr("เลขผู้เสียภาษี")}</dt>
                  <dd>{p.taxId}</dd>
                </>
              )}
              {p.phone && (
                <>
                  <dt>{tr("โทร")}</dt>
                  <dd>{p.phone}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <div className="pd-s-box">
          <div className="pd-s-label">{showVehicle ? tr("ข้อมูลรถ / การชำระเงิน") : tr("การชำระเงิน")}</div>
          <dl className="pd-s-dl">
            {showVehicle && m.vehicle?.plate && (
              <>
                <dt>{tr("ทะเบียนรถ")}</dt>
                <dd>{m.vehicle.plate}</dd>
              </>
            )}
            {showVehicle && m.vehicle?.model && (
              <>
                <dt>{tr("รุ่นรถ")}</dt>
                <dd>{m.vehicle.model}</dd>
              </>
            )}
            {showVehicle && m.vehicle?.mileage ? (
              <>
                <dt>{tr("เลขไมล์")}</dt>
                <dd>{km(m.vehicle.mileage)}</dd>
              </>
            ) : null}
            <dt>{tr("ชำระโดย")}</dt>
            <dd>{m.paymentMethod}</dd>
            <dt>{tr("สถานะ")}</dt>
            <dd>{m.unpaid ? <span className="pd-s-flag">{tr("ค้างชำระ")}</span> : tr("ชำระแล้ว")}</dd>
          </dl>
        </div>
      </section>

      <table className="pd-s-items">
        <colgroup>
          <col style={{ width: "7%" }} />
          <col />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "13%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="pd-c">{tr("ลำดับ")}</th>
            <th>{tr("รายการ")}</th>
            <th className="pd-r">{tr("จำนวน")}</th>
            <th>{tr("หน่วย")}</th>
            <th className="pd-r">{tr("ราคา/หน่วย")}</th>
            <th className="pd-r">{tr("ส่วนลด")}</th>
            <th className="pd-r">{tr("จำนวนเงิน")}</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l) => (
            <tr key={l.no}>
              <td className="pd-c pd-num">{l.no}</td>
              <td>
                {l.name}
                {l.note && <div className="pd-s-itemnote">{l.note}</div>}
              </td>
              <td className="pd-r pd-num">{formatQty(l.qty)}</td>
              <td>{l.unit ?? ""}</td>
              <td className="pd-r pd-num">{formatMoney(l.unitPrice)}</td>
              <td className="pd-r pd-num">{l.discount > 0 ? formatMoney(l.discount) : "-"}</td>
              <td className="pd-r pd-num">{formatMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="pd-s-summary">
        <div>
          <div className="pd-s-words">({m.totalText})</div>
          {m.note && (
            <div className="pd-s-note">
              <b>{tr("หมายเหตุ:")}</b> {m.note}
            </div>
          )}
        </div>
        <table className="pd-s-totals">
          <tbody>
            <tr>
              <td>{tr("รวมเป็นเงิน")}</td>
              <td className="pd-num">{formatMoney(m.subtotal)}</td>
            </tr>
            {m.discount > 0 && (
              <tr>
                <td>{tr("ส่วนลด")}</td>
                <td className="pd-num">{neg(m.discount)}</td>
              </tr>
            )}
            {m.vatMode === "exclusive" && (
              <>
                {m.discount > 0 && (
                  <tr>
                    <td>{tr("มูลค่าก่อนภาษี")}</td>
                    <td className="pd-num">{formatMoney(m.beforeVat)}</td>
                  </tr>
                )}
                <tr>
                  <td>{tr("ภาษีมูลค่าเพิ่ม {0}%", formatRate(m.vatRate))}</td>
                  <td className="pd-num">{formatMoney(m.vatAmount)}</td>
                </tr>
              </>
            )}
            <tr className="pd-s-grand">
              <td>{tr("จำนวนเงินรวมทั้งสิ้น")}</td>
              <td className="pd-num">฿{formatMoney(m.total)}</td>
            </tr>
            {m.vatMode === "inclusive" && (
              <>
                <tr className="pd-s-sub">
                  <td colSpan={2} className="pd-s-subhead">
                    {tr("ราคารวมภาษีมูลค่าเพิ่มแล้ว")}
                  </td>
                </tr>
                <tr className="pd-s-sub">
                  <td>{tr("มูลค่าก่อนภาษี")}</td>
                  <td className="pd-num">{formatMoney(m.beforeVat)}</td>
                </tr>
                <tr className="pd-s-sub">
                  <td>{tr("ภาษีมูลค่าเพิ่ม {0}%", formatRate(m.vatRate))}</td>
                  <td className="pd-num">{formatMoney(m.vatAmount)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      <section className="pd-s-signs">
        {m.signatures.map((label) => (
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
            <div className="pd-s-signrow pd-s-signdate pd-muted">
              <span>{tr("วันที่")}</span>
              <span className="pd-s-dots" />
              <span>/</span>
              <span className="pd-s-dots" />
              <span>/</span>
              <span className="pd-s-dots" />
            </div>
          </div>
        ))}
      </section>

      {m.footer && <footer className="pd-s-foot">{m.footer}</footer>}
    </div>
  );
}
