package com.acme.obs.quickstart;

import com.acme.obs.instrumentation.worker.ObsWorkerMetrics;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 10-minute integration proof: a minimal Spring Boot app with
 * obs-instrumentation-spring-boot-starter on the classpath and nothing
 * else -- no code registers the HTTP metrics, the auto-configuration
 * already did.
 *
 *   mvn spring-boot:run
 *   curl localhost:8080/hello/arda
 *   curl localhost:8080/actuator/prometheus
 */
@SpringBootApplication
@RestController
public class QuickstartApplication {

    private final ObsWorkerMetrics workerMetrics;

    public QuickstartApplication(ObsWorkerMetrics workerMetrics) {
        this.workerMetrics = workerMetrics;
    }

    public static void main(String[] args) {
        SpringApplication.run(QuickstartApplication.class, args);
    }

    @GetMapping("/hello/{name}")
    public String hello(@PathVariable String name) {
        // Also demonstrates the worker API, even in an HTTP handler: any
        // unit of work you want a duration/outcome for can use it.
        var job = workerMetrics.startJob("greetings");
        try {
            String greeting = "hello, " + name;
            job.finish(true);
            return greeting;
        } catch (RuntimeException e) {
            job.finish(false);
            throw e;
        }
    }

    @GetMapping("/boom")
    public String boom() {
        throw new IllegalStateException("simulated failure");
    }
}
