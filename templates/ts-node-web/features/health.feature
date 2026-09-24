# Spec paired with src/domain/health (CHANGE-3 DoD).
Feature: Service health
  As a user of the system
  I want to know the service is alive
  So that I can trust the application is running

  # Slots: every @op needs @happy plus ≥1 @unhappy or @edge (D11).
  @op:getHealth @happy
  Scenario: Health endpoint reports ok
    When I request the service health
    Then the health status is "ok"

  @op:getHealth @edge
  Scenario: Health response names the running service
    When I request the service health
    Then the health service name is "my-gauntlet-app"
