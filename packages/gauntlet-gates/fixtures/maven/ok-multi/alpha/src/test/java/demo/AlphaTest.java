package demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AlphaTest {
  @Test
  void greets() {
    assertEquals("hello dev", Alpha.greet("dev"));
  }
}
