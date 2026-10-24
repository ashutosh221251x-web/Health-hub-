import { useEffect, useState } from "react";
import { CalendarClock, CreditCard, MessageCircle, QrCode, Video } from "lucide-react";
import { toast } from "sonner";
import SiteHeader from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { consultationPlans, consultationPrices, experts } from "./Home";
import { formatINR } from "@/lib/currency";

export default function Experts() {
  const [credits, setCredits] = useState({ chat: 0, video: 0 });
  const [paymentPlan, setPaymentPlan] = useState<typeof consultationPlans[number] | null>(null);
  const [paymentMode, setPaymentMode] = useState<"card" | "upi">("card");
  const [paymentDetails, setPaymentDetails] = useState({ name: "", card: "", expiry: "", cvc: "", upi: "" });
  const [qrPayment, setQrPayment] = useState<{ paymentId: string; qrCode: string; status: string } | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem("health-hub-consult-credits");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed.chat === "number" && typeof parsed.video === "number") setCredits({ chat: parsed.chat, video: parsed.video });
    } catch {
      window.localStorage.removeItem("health-hub-consult-credits");
    }
  }, []);
  const activate = (plan: typeof consultationPlans[number]) => {
    setPaymentPlan(plan);
    setQrPayment(null);
  };
  const completePayment = async () => {
    if (!paymentPlan) return;
    if (paymentMode === "card" && (!paymentDetails.name.trim() || paymentDetails.card.replace(/\s/g, "").length < 12 || !paymentDetails.expiry.trim() || paymentDetails.cvc.trim().length < 3)) {
      toast.error("Complete the card details to continue");
      return;
    }
    if (paymentMode === "upi" && !paymentDetails.upi.includes("@")) {
      toast.error("Enter a valid UPI ID");
      return;
    }
    try {
      const response = await fetch("/api/payment/qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: paymentPlan.price, items: [paymentPlan.name] }) });
      if (!response.ok) throw new Error("Payment could not be created");
      const payment = await response.json();
      setQrPayment(payment);
    } catch (error) {
      console.error(error);
      toast.error("Payment unavailable", { description: "Please try again in a moment." });
    }
  };
  const confirmPayment = async () => {
    if (!qrPayment || !paymentPlan) return;
    const response = await fetch("/api/payment/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: qrPayment.paymentId }) });
    if (!response.ok) {
      toast.error("Payment confirmation failed");
      return;
    }
    const next = { chat: credits.chat + paymentPlan.chatCredits, video: credits.video + paymentPlan.videoCredits };
    setCredits(next);
    window.localStorage.setItem("health-hub-consult-credits", JSON.stringify(next));
    toast.success(`${paymentPlan.name} activated`, { description: `${formatINR(paymentPlan.price)} payment confirmed and credits added.` });
    setPaymentPlan(null);
  };
  const start = async (expert: typeof experts[number], mode: "chat" | "video") => {
    if (mode === "chat") { toast.success(`Chat request sent to ${expert.name}`, { description: `${formatINR(consultationPrices.chat)} consultation · They'll reply during their next available window.` }); return; }
    try { const response = await fetch("/api/video-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expert: expert.name, mode }) }); const data = await response.json(); window.open(data.joinUrl || "https://meet.google.com/new", "_blank", "noopener,noreferrer"); toast.success("Your demo consultation room is ready", { description: `${formatINR(consultationPrices.video)} video consultation` }); } catch { window.open("https://meet.google.com/new", "_blank", "noopener,noreferrer"); }
  };
  return <div className="min-h-screen bg-[#f4f1e9] text-[#173d32]"><SiteHeader /><main className="mx-auto max-w-7xl px-5 py-12 lg:px-10"><p className="text-xs font-bold uppercase tracking-[.25em] text-[#b07926]">Human support</p><h1 className="mt-2 font-display text-5xl">Meet your wellness team</h1><p className="mt-4 max-w-2xl text-[#173d32]/65">Start a gentle conversation with a qualified guide. Consultations are educational and never replace urgent medical care.</p>    <div className="mt-8 rounded-3xl border border-[#173d32]/10 bg-[#edf3ea] p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#b07926]">Flexible access</p><h2 className="mt-2 font-display text-3xl">Subscribe or recharge</h2><p className="mt-1 text-sm text-[#173d32]/65">Your credits stay on this device until you use them.</p></div><p className="text-sm font-semibold">{credits.chat} chat · {credits.video} video credits</p></div><div className="mt-5 grid gap-3 md:grid-cols-2">{consultationPlans.map((plan) => <button key={plan.id} type="button" onClick={() => activate(plan)} className="rounded-2xl border border-[#173d32]/10 bg-white p-4 text-left transition hover:border-[#d79a32]"><div className="flex items-center justify-between gap-3"><span className="font-semibold">{plan.name}</span><span className="font-display text-xl">{formatINR(plan.price)}</span></div><p className="mt-1 text-sm text-[#173d32]/60">{plan.detail}</p><span className="mt-3 inline-block text-[10px] font-bold uppercase tracking-[.14em] text-[#b07926]">Pay & activate</span></button>)}</div></div><div className="mt-10 grid gap-6 md:grid-cols-3">{experts.map((expert) => <article key={expert.id} className="rounded-3xl border border-[#173d32]/10 bg-white p-6 shadow-sm"><div className="grid h-20 w-20 place-items-center rounded-2xl text-2xl font-bold" style={{ backgroundColor: expert.tone }}>{expert.initials}</div><h2 className="mt-5 font-display text-2xl">{expert.name}</h2><p className="mt-1 font-semibold text-[#b07926]">{expert.specialty}</p><p className="mt-4 flex items-center gap-2 text-sm text-[#173d32]/65"><CalendarClock className="h-4 w-4" />{expert.availability}</p><p className="mt-2 text-sm text-[#173d32]/55">{expert.mode}</p>  <div className="mt-6 flex gap-2"><Button variant="outline" onClick={() => start(expert, "chat")}><MessageCircle className="h-4 w-4" /> Chat · {formatINR(consultationPrices.chat)}</Button><Button onClick={() => start(expert, "video")}><Video className="h-4 w-4" /> Video · {formatINR(consultationPrices.video)}</Button></div></article>)}</div><div className="mt-12 rounded-3xl bg-[#173d32] p-8 text-white"><h2 className="font-display text-3xl">Need immediate help?</h2><p className="mt-2 text-white/70">For emergencies, contact your local emergency services. For routine care, use our nearby care finder on the home page.</p></div>  </main><Dialog open={Boolean(paymentPlan)} onOpenChange={(open) => { if (!open) setPaymentPlan(null); }}><DialogContent className="max-w-md rounded-3xl"><DialogHeader><DialogTitle>{paymentPlan?.name} · {paymentPlan && formatINR(paymentPlan.price)}</DialogTitle><DialogDescription>Secure demo checkout. Credits are added only after confirmation.</DialogDescription></DialogHeader>{qrPayment ? <div className="text-center"><img src={qrPayment.qrCode} alt="UPI payment QR code" className="mx-auto h-48 w-48 rounded-2xl border p-3" /><p className="mt-3 text-sm text-[#173d32]/65">Scan with any UPI app, then confirm payment.</p><Button className="mt-4 w-full" onClick={confirmPayment}><QrCode className="h-4 w-4" /> Confirm payment</Button></div> : <div className="space-y-3"><div className="flex gap-2"><button type="button" className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${paymentMode === "card" ? "bg-[#173d32] text-white" : "bg-[#edf3ea]"}`} onClick={() => setPaymentMode("card")}><CreditCard className="mr-1 inline h-4 w-4" /> Card</button><button type="button" className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${paymentMode === "upi" ? "bg-[#173d32] text-white" : "bg-[#edf3ea]"}`} onClick={() => setPaymentMode("upi")}><QrCode className="mr-1 inline h-4 w-4" /> UPI</button></div>{paymentMode === "card" ? <><input value={paymentDetails.name} onChange={(e) => setPaymentDetails({ ...paymentDetails, name: e.target.value })} placeholder="Name on card" className="h-11 w-full rounded-xl border px-3" /><input value={paymentDetails.card} onChange={(e) => setPaymentDetails({ ...paymentDetails, card: e.target.value })} placeholder="Card number" inputMode="numeric" className="h-11 w-full rounded-xl border px-3" /><div className="grid grid-cols-2 gap-3"><input value={paymentDetails.expiry} onChange={(e) => setPaymentDetails({ ...paymentDetails, expiry: e.target.value })} placeholder="MM/YY" className="h-11 rounded-xl border px-3" /><input value={paymentDetails.cvc} onChange={(e) => setPaymentDetails({ ...paymentDetails, cvc: e.target.value })} placeholder="CVC" inputMode="numeric" className="h-11 rounded-xl border px-3" /></div></> : <input value={paymentDetails.upi} onChange={(e) => setPaymentDetails({ ...paymentDetails, upi: e.target.value })} placeholder="yourname@upi" className="h-11 w-full rounded-xl border px-3" />}<Button className="w-full" onClick={completePayment}>Pay {paymentPlan && formatINR(paymentPlan.price)}</Button></div>}<DialogFooter><p className="text-xs text-[#173d32]/55">Demo payment mode · connect your live gateway before launch.</p></DialogFooter></DialogContent></Dialog></div>;
}
