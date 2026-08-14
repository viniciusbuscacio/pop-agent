package loginitem

func Enabled() (bool, error)      { return enabled() }
func SetEnabled(value bool) error { return setEnabled(value) }
