package shapes

func Total(ss []Shape) float64 {
	t := 0.0
	for _, s := range ss {
		t += s.Area()
	}
	return t + helper()
}
