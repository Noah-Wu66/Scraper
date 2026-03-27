import { WechatUploadForm } from "@/components/wechat-upload-form";

export default function WechatImportPage() {
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h2>微信 CSV 导入</h2>
          <p>这部分继续沿用你现在的工作方式，不强行改造成在线抓取链路。</p>
        </div>
      </header>
      <section className="panel">
        <WechatUploadForm />
      </section>
    </div>
  );
}
