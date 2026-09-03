Feature: Service health
  As a user of the system
  I want to know the service is alive
  So that I can trust the application is running

  @op:getHealth
  Scenario: Health endpoint reports ok
    When I request the service health
    Then the health status is "ok"
