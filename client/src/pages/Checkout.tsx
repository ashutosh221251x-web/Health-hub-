import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, Minus, Plus, QrCode, ShoppingBag } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import SiteHeader from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { featuredProducts, type Product } from "./Home";
import { formatINR } from "@/lib/currency";

export default function Checkout() {
  const [, navigate] = useLocation();
  const [cart, setCart] = useState<Product[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("herbal-health-cart") || "[]") as Product[];
    } catch {
      return [];
    }
  });
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMode, setPaymentMode] = useState<"card" | "qr">("card");
  const [qrPayment, setQrPayment] = useState<{ paymentId: string; qrCode: string; status: string; amount: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const grouped = useMemo(() => featuredProducts
    .map((product) => ({ product, quantity: cart.filter((item) => item.id === product.id).length }))
    .filter((item) => item.quantity > 0), [cart]);
  const total = grouped.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  const changeQuantity = (product: Product, delta: number) => {
    const next = [...cart];
    if (delta > 0) next.push(product);
    else {
      const index = next.findIndex((item) => item.id === product.id);
      if (index >= 0) next.splice(index, 1);
    }
    setCart(next);
    localStorage.setItem("herbal-health-cart", JSON.stringify(next));
  };

  const placeOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !fullName || !address || !grouped.length) {
      toast.error("Add your name, email, address, and at least one product.");
      return;
    }
    if (paymentMode === "qr") {
      const response = await fetch("/api/payment/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total, items: cart.map((item) => item.name) }),
      });
      if (!response.ok) {
        toast.error("We could not create a payment QR code.");
        return;
      }
      setQrPayment(await response.json());
      return;
    }
    await submitOrder();
  };

  const submitOrder = async () => {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, customer: fullName, address, items: cart.map((item) => item.name), total }),
    });
    if (!response.ok) {
      toast.error("We could not place that order. Please try again.");
      return;
    }
    localStorage.removeItem("herbal-health-cart");
    setCart([]);
    setSubmitted(true);
  };

  const confirmQrPayment = async () => {
    if (!qrPayment) return;
    const response = await fetch("/api/payment/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: qrPayment.paymentId }),
    });
    if (!response.ok) {
      toast.error("Payment could not be confirmed.");
      return;
    }
    await submitOrder();
  };

  return (
    <div className="min-h-screen bg-[#f4f1e9] text-[#173d32]">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-12 lg:px-10">
        <Link href="/products" className="inline-flex items-center gap-2 text-sm font-semibold text-[#173d32]/65 hover:text-[#173d32]"><ArrowLeft className="h-4 w-4" /> Continue shopping</Link>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
          <section>
            <p className="text-xs font-bold uppercase tracking-[.25em] text-[#b07926]">Secure checkout</p>
            <h1 className="mt-2 font-display text-5xl tracking-tight">Make it part of your rhythm.</h1>
            {submitted ? (
              <div className="mt-10 rounded-3xl bg-white p-10 text-center shadow-sm"><CheckCircle2 className="mx-auto h-12 w-12 text-[#2f8d61]" /><h2 className="mt-4 font-display text-3xl">Order received</h2><p className="mt-2 text-[#173d32]/65">A confirmation will be sent to {email}.</p><Button className="mt-6" onClick={() => navigate("/products")}>Explore more products</Button></div>
            ) : (
              <form onSubmit={placeOrder} className="mt-8 space-y-5 rounded-3xl border border-[#173d32]/10 bg-white p-6 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">Full name<Input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 rounded-xl" placeholder="Your name" /></label>
                  <label className="block text-sm font-semibold">Email for updates<Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 rounded-xl" placeholder="you@example.com" /></label>
                </div>
                <label className="block text-sm font-semibold">Delivery address<Input required value={address} onChange={(event) => setAddress(event.target.value)} className="mt-2 rounded-xl" placeholder="Street, city, postcode" /></label>
                <div className="rounded-2xl bg-[#f7f3eb] p-4 text-sm text-[#173d32]/70">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPaymentMode("card")} className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${paymentMode === "card" ? "bg-[#173d32] text-white" : "bg-white"}`}><CreditCard className="mr-1 inline h-4 w-4" />Card / demo</button>
                    <button type="button" onClick={() => setPaymentMode("qr")} className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${paymentMode === "qr" ? "bg-[#173d32] text-white" : "bg-white"}`}><QrCode className="mr-1 inline h-4 w-4" />UPI QR</button>
                  </div>
                  {qrPayment ? <div className="mt-4 text-center"><img src={qrPayment.qrCode} alt="UPI payment QR code" className="mx-auto h-36 w-36 rounded-xl bg-white p-2" /><p className="mt-2">Scan, then confirm payment.</p><Button type="button" className="mt-3" onClick={confirmQrPayment}>Confirm payment</Button></div> : <p className="mt-3">Demo checkout is safe and does not charge a card unless a provider is configured.</p>}
                </div>
                {!qrPayment && <Button type="submit" className="w-full" disabled={!grouped.length}>{paymentMode === "qr" ? "Generate QR" : "Place order"} · {formatINR(total)}</Button>}
              </form>
            )}
          </section>
          <aside className="rounded-3xl bg-[#173d32] p-6 text-white">
            <div className="flex items-center justify-between"><h2 className="font-display text-3xl">Your basket</h2><ShoppingBag className="h-5 w-5 text-[#f4cc86]" /></div>
            {!grouped.length ? <p className="mt-8 text-white/65">Your basket is waiting for something good.</p> : <div className="mt-6 space-y-4">{grouped.map(({ product, quantity }) => <div key={product.id} className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{product.name}</p><p className="mt-1 text-xs text-white/60">{formatINR(product.price)} · {product.unit}</p></div><p className="font-semibold">{formatINR(product.price * quantity)}</p></div><div className="mt-3 flex items-center gap-2"><button type="button" aria-label={`Decrease ${product.name}`} onClick={() => changeQuantity(product, -1)} className="rounded-full border border-white/15 p-1"><Minus className="h-3 w-3" /></button><span className="min-w-6 text-center text-sm">{quantity}</span><button type="button" aria-label={`Increase ${product.name}`} onClick={() => changeQuantity(product, 1)} className="rounded-full border border-white/15 p-1"><Plus className="h-3 w-3" /></button></div></div>)}</div>}
            <div className="mt-8 flex justify-between border-t border-white/15 pt-4 text-lg font-semibold"><span>Total</span><span>{formatINR(total)}</span></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
