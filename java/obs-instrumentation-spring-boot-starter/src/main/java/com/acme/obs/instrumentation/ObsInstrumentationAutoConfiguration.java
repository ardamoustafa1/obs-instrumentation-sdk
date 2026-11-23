package com.acme.obs.instrumentation;

import com.acme.obs.instrumentation.web.ObsHttpMetricsFilter;
import com.acme.obs.instrumentation.worker.ObsWorkerMetrics;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.Filter;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;

/**
 * Auto-configuration: adding this starter as a Maven dependency is the
 * entire integration -- no application code required. Meters are
 * registered into whichever {@link MeterRegistry} Spring Boot Actuator has
 * already configured (Prometheus via {@code micrometer-registry-prometheus},
 * OTLP via {@code micrometer-registry-otlp}, or both at once through
 * Micrometer's composite registry) -- see README.md "Neden kendi
 * PrometheusMeterRegistry'mizi kurmuyoruz?" for why this starter never
 * builds its own registry, and how that also gives it OTLP push and
 * exemplars for free.
 */
@AutoConfiguration
@ConditionalOnClass({MeterRegistry.class, Filter.class})
@EnableConfigurationProperties(ObsInstrumentationProperties.class)
public class ObsInstrumentationAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public ObsHttpMetricsFilter obsHttpMetricsFilter(MeterRegistry registry, ObsInstrumentationProperties properties) {
        return new ObsHttpMetricsFilter(registry, properties);
    }

    @Bean
    public FilterRegistrationBean<ObsHttpMetricsFilter> obsHttpMetricsFilterRegistration(ObsHttpMetricsFilter filter) {
        FilterRegistrationBean<ObsHttpMetricsFilter> registration = new FilterRegistrationBean<>(filter);
        // Run first so recorded duration covers every other filter
        // (security, tracing, etc.) in the chain too.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        registration.addUrlPatterns("/*");
        return registration;
    }

    @Bean
    @ConditionalOnMissingBean
    public ObsWorkerMetrics obsWorkerMetrics(MeterRegistry registry, ObsInstrumentationProperties properties) {
        return new ObsWorkerMetrics(registry, properties);
    }
}
