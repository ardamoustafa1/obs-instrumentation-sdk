# obs-instrumentation-sdk

Takımların servislerine ekleyip Golden Signals'ı OpenTelemetry semantic
conventions'a uyumlu, `obs-manifest-schema`'nın
[naming-convention.md](../obs-manifest-schema/naming-convention.md)'ine uyan
standart isimlerle otomatik export etmelerini sağlayan kütüphane seti. Üç dil,
üç bağımsız paket, tek ortak sözleşme:

```text
.
├── go/       # Go modülü            -- github.com/acme/obs-instrumentation-sdk/go
├── node/     # npm paketi           -- @acme/obs-instrumentation
├── java/     # Maven/Spring Boot    -- com.acme.obs:obs-instrumentation-spring-boot-starter
└── .github/workflows/               # her dil için ayrı release pipeline'ı
```

Her dil kendi `go.mod` / `package.json` / `pom.xml`'iyle **bağımsız
semver** taşır (bkz. [§ Versiyon uyumluluk politikası](#versiyon-uyumluluk-politikası)).
Aralarındaki tek sözleşme, aşağıdaki metrik isimleri/label'ları/tipleridir --
bunlardan biri değişirse üçü de aynı anda, aynı major bump ile değişir.

## Metric naming contract

Bu tablo üç dilde de **birebir aynı** metrik ailesini tanımlar. Instrument
adları OpenTelemetry semantic conventions'daki noktalı adların (`http.server.request.duration`)
Prometheus exposition'ındaki karşılığıdır (`http_server_request_duration_seconds`);
her SDK, OTLP push açıkken de aynı OTel adını kullanır (bkz. tablo altındaki
"OTel instrument adı" kolonu) böylece iki export yolu (`/metrics` ve OTLP)
aynı sinyali farklı isimlerle ikiye bölmez.

### HTTP middleware modülü

| Prometheus adı | OTel instrument adı | Tip | Unit | Label'lar | Golden signal |
|---|---|---|---|---|---|
| `http_server_requests_total` | `http.server.request.count` | Counter | `1` | `method`, `route`, `code` | Traffic |
| `http_server_request_errors_total` | `http.server.request.error.count` | Counter | `1` | `method`, `route`, `code` | Error (yalnız `code >= 500`, bkz. altta) |
| `http_server_request_duration_seconds` | `http.server.request.duration` | Histogram | `s` | `method`, `route` | Latency |
| `http_server_active_requests` | `http.server.active_requests` | Gauge (asenkron/UpDownCounter) | `1` | `method` | Saturation |

- **`route`**: gerçek istek path'i değil, router'ın template'i (`/users/:id`,
  `/users/{id}`, framework'e göre). Ham path label yapmak sınırsız
  cardinality üretir (naming-convention.md kural 6) -- bu yüzden her üç SDK
  da route'u router'ın kendi eşleşme mekanizmasından okur, asla `req.url`'den
  değil (route bulunamazsa `unmatched` kullanılır, `/` gibi statik bir path
  değil, aksi halde tüm eşleşmeyen path'ler tek bir label değeriyle karışır
  ama patlamaz).
- **`code`**: sayısal HTTP status code'un string hâli (`"200"`, `"404"`, ...).
- **`http_server_request_errors_total`**: `http_server_requests_total`'ın bir
  alt kümesi değil, ayrı bir counter'dır -- `obs-manifest-schema` testdata'sı
  ve `obs-alert-rule-templates`'in burn-rate şablonu `errorMetric`'i bağımsız
  bir seri olarak sorgular (`sum(rate(errorMetric)) / sum(rate(trafficMetric))`);
  SDK bunu bir recording-rule'a ihtiyaç bırakmadan hazır sağlar. Varsayılan
  eşik `code >= 500`; `IsError` (Go) / `isError` (Node) / `errorPredicate`
  (Java) ile özelleştirilebilir (örn. 4xx'i de saymak isteyen bir takım için).
- **Histogram bucket sınırları** (5ms-10s aralığı, requirement'ta istenen):

  ```text
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ```

  Bu, Prometheus istemci kütüphanelerinin endüstri standardı "default
  buckets" dizisidir (`prometheus.DefBuckets` Go'da, `promClient.exponentialBuckets`
  yerine literal aynı dizi Node/Java'da) -- üç SDK da bunu varsayılan olarak
  kullanır ve override edilebilir bırakır (örn. bir database servisi 10s'nin
  üstünde de örnekleme isteyebilir).

### Worker/queue modülü

| Prometheus adı | OTel instrument adı | Tip | Unit | Label'lar | Golden signal |
|---|---|---|---|---|---|
| `worker_jobs_processed_total` | `worker.job.processed.count` | Counter | `1` | `queue`, `status` (`success`\|`failure`) | Traffic + Error |
| `worker_job_duration_seconds` | `worker.job.duration` | Histogram | `s` | `queue` | Latency (processingDurationMetric) |
| `worker_queue_depth` | `worker.queue.depth` | Gauge | `1` | `queue` | Saturation |

HTTP modülünün aksine bu modül middleware değildir -- otomatik saramayacağı
için (bir job'ın "başlangıcı/bitişi" framework'e göre değişir) manuel bir API
sağlar: `StartJob()/Finish()` (Go), `startJob()/finish()` (Node),
`WorkerMetrics.timeJob(...)` (Java). Üçü de aynı iki satırlık kalıba
indirger: "job başladı" + "job bitti (success|failure)".

### Exemplar sözleşmesi

Her histogram observation'ı, çağrı context'inde aktif bir OpenTelemetry span
varsa, o span'ın `trace_id`'sini exemplar olarak ekler -- **sıfır ek kod**,
sadece OTel tracing'i kuran taraf bunu bağladığında otomatik devreye girer
(bkz. her dilin kendi README'sindeki "Exemplars" bölümü). Prometheus
exemplar'ları yalnızca OpenMetrics exposition formatında taşıdığı için
`/metrics` endpoint'i `Accept: application/openmetrics-text` header'ı
geldiğinde OpenMetrics, aksi halde klasik Prometheus text formatını döner
(üç kütüphane de bunu istemci kütüphanesinin content-negotiation'ına
bırakır).

## Versiyon uyumluluk politikası

- Her paket **kendi semver**'ini taşırıyla (Go `go/vX.Y.Z` tag'i, npm
  `@acme/obs-instrumentation@X.Y.Z`, Maven `com.acme.obs:obs-instrumentation-spring-boot-starter:X.Y.Z`);
  paketler arası "aynı major olmalı" zorunluluğu yoktur.
- **Metric naming contract** (yukarıdaki tablolar) üçü için ortaktır ve bu
  depoda `CONTRACT.md`'de sürümlenir (`contract: 1.0.0`). Bir dilin
  kütüphanesi contract'ı **breaking** şekilde değiştirirse (isim, unit veya
  zorunlu label kaldırma/değiştirme), o dilin paketi MAJOR bump alır VE
  `CONTRACT.md`'ye yeni bir sürüm girilir; diğer iki dil bir sonraki minor
  release'inde aynı contract sürümüne yetişmek zorundadır (en fazla bir
  minor sürüm gecikmeyle -- CI'daki `contract-drift-check` job'u üç dilin
  test suite'lerinin aynı `CONTRACT.md` sürümüne karşı geçtiğini doğrular,
  bkz. [.github/workflows/ci.yml](.github/workflows/ci.yml)'in `contract-drift-check` job'ı).
- Label **eklemek** (yeni, opsiyonel bir label) MINOR; var olanı kaldırmak
  veya anlamını değiştirmek MAJOR sayılır (Prometheus'ta bir label'ın
  kaldırılması var olan dashboard/alert PromQL'lerini sessizce kırar).
- Desteklenen çalışma zamanları: Go >= 1.22 (route extraction, `net/http.ServeMux`
  pattern desteği için) fakat `go.mod`'daki güncel `go` direktifi, OpenTelemetry
  bağımlılıklarının zorunlu kıldığı daha yeni bir toolchain'i işaret edebilir
  -- gerçek minimum için her zaman `go/go.mod`'a bakın; Node.js >= 18 (LTS); Java >= 17
  + Spring Boot >= 3.x. Bir runtime EOL olduğunda bir sonraki MAJOR'da
  bırakılır, MINOR'da değil.

## CHANGELOG konvansiyonu

Her paket kendi `CHANGELOG.md`'sini [Keep a Changelog](https://keepachangelog.com/)
formatında tutar; girdiler [Conventional Commits](https://www.conventionalcommits.org/)
commit mesajlarından otomatik üretilir:

- `fix:` -> PATCH, `Fixed` bölümü.
- `feat:` -> MINOR, `Added`/`Changed` bölümü.
- `feat!:` veya commit body'sinde `BREAKING CHANGE:` -> MAJOR, `Changed`
  bölümünde açıkça "BREAKING" etiketiyle.
- Metric naming contract'ı etkileyen her değişiklik, hangi conventional
  commit tipinde olursa olsun, changelog girdisine `[contract]` etiketi ve
  `CONTRACT.md`'deki yeni sürüm numarasını eklemek zorundadır -- bir takımın
  "neden dashboard'um bozuldu" diye üç ayrı CHANGELOG'a bakmadan
  anlayabilmesi için.

Otomasyon: her dilin CI pipeline'ı release-please (Go, Node) / a Maven
release plugin tetiklenen conventional-commit taraması (Java) ile
CHANGELOG'u ve sürüm numarasını PR olarak açar; merge, yayınlama adımını
tetikler (bkz. [§ Yayınlama](#yayınlama)).

## Yayınlama

| Dil | Hedef | Tetikleyici | Workflow |
|---|---|---|---|
| Go | GitHub (Go module proxy `go.mod` tag'i üzerinden çeker, ayrı bir "publish" adımı yok) | `go/vX.Y.Z` git tag push | [.github/workflows/go-release.yml](.github/workflows/go-release.yml) |
| Node.js | npm registry, paket adı `@acme/obs-instrumentation` | `node-vX.Y.Z` git tag push | [.github/workflows/node-release.yml](.github/workflows/node-release.yml) |
| Java | Maven Central (Sonatype OSSRH aracılığıyla) + GitHub Packages'a ayna | `java-vX.Y.Z` git tag push | [.github/workflows/java-release.yml](.github/workflows/java-release.yml) |

Üçü de aynı deponun farklı alt dizinlerinde yaşadığı için tag prefix'i
(`go-`, `node-`, `java-`) hangi paketin release edildiğini ayırt eder;
release workflow'ları `paths` filtresiyle yalnızca kendi alt dizinlerindeki
tag'lere/push'lara tepki verir.

## Quickstart'lar

- [go/quickstart](go/quickstart) -- `net/http` ile minimal server, `docker build && docker run` ile 10 dakikada ayağa kalkar.
- [node/quickstart](node/quickstart) -- Express örneği (Fastify eşdeğeri README'de).
- [java/quickstart](java/quickstart) -- minimal Spring Boot uygulaması.

Her biri aynı üç adımı izler: (1) bağımlılığı ekle, (2) middleware'i/starter'ı
kaydet, (3) `/metrics`'i `curl` ile doğrula. Detaylar her alt dizinin kendi
README'sinde.
